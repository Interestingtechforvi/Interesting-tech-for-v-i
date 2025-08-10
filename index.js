const express = require("express");
const qrcode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const axios = require("axios");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    isJidGroup,
    DisconnectReason,
    downloadMediaMessage,
} = require("@whiskeysockets/baileys");

// Import custom modules with corrected names
const { getModelInfo, generateSpeech, analyzeImageWithGemini } = require("./gemini-config.js");
const { processAudio, generateAudioFromText } = require("./audio-transcription.js");
const { extractPdfText, analyzePdfContent, processImageForAnalysis, generateImage, getMediaProcessingStatus } = require("./media-processor.js");

// --- Global Variables ---
const app = express();
let qrCodeImage = "";
let isConnected = false;
let sock;

// State variables for commands
let ttsModeActive = {}; // Stores JID for users in TTS mode
const geminiVoices = [
    { id: 1, name: "female_voice", description: "Standard Female Voice" },
    { id: 2, name: "male_voice", description: "Standard Male Voice" }
];
let userSelectedVoice = {}; // Stores selected voice for each JID

const POLLINATIONS_TEXT_API_BASE = "https://text.pollinations.ai/prompt=";
const POLLINATIONS_PROMPT_SUFFIX = encodeURIComponent("If someone asks about you, just say: *I am Kuldeep Behera.* Don’t say anything else about being AI. Reply in the same language and style as the person’s message, using simple words matching their tone. If they ask or suggest something, reply only exactly what’s asked—no extra info. Try to understand their relation to Kuldeep Behera without asking, and reply like Kuldeep himself would, respectfully but casually. If you can’t answer, politely say: *I’m busy with my studies/college/music class, I’ll reply later.* Don’t mention you are an AI or assistant. If asked to generate things (code, email, articles ), generate in English by default unless they specify another language. For poems, jokes, or stories, generate in the same language as the request. Never reply negatively or ignore; you can respond or say you’ll reply later if the message is very personal or that kind of message you are not able to reply. don't use tum, tu, or any kind of un respective words just use aap in hindi or any language. userprompt?model=openai-large&referrer=onrender.com");

/**
 * Generate text response using Pollinations.ai
 * @param {string} text - The user's question.
 * @returns {Promise<string>} - The response from Pollinations.ai.
 */
async function getPollinationsTextResponse(text) {
    try {
        const encodedUserPrompt = encodeURIComponent(text);
        const apiUrl = `${POLLINATIONS_TEXT_API_BASE}${POLLINATIONS_PROMPT_SUFFIX.replace("userprompt", encodedUserPrompt)}`;
        
        const response = await axios.get(apiUrl);
        return response.data;
    } catch (error) {
        console.error("Pollinations.ai text API error:", error);
        return "❌ Sorry, I'm experiencing technical difficulties with text generation. Please try again later.";
    }
}

// --- Main WhatsApp Bot Logic ---
async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_multi");
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        qrTimeout: 30000,
        defaultQueryTimeoutMs: 0,
    });

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCodeImage = await qrcode.toDataURL(qr);
        }
        if (connection === "open") {
            isConnected = true;
            console.log("✅ WhatsApp Connected Successfully!");
        } else if (connection === "close") {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            
            if (statusCode && statusCode !== DisconnectReason.loggedOut) {
                console.log("Connection closed due to an error, reconnecting...");
                setTimeout(() => startWhatsApp(), 5000);
            } else {
                console.log("Connection closed. You have been logged out.");
                qrCodeImage = ""; 
            }
        }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];

        if (!msg.message || msg.key.fromMe || isJidGroup(msg.key.remoteJid)) {
            return;
        }

        const remoteJid = msg.key.remoteJid;
        const incomingText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        try {
            await sock.readMessages([msg.key]);
            await sock.sendPresenceUpdate("composing", remoteJid);

            let replyText = "";
            let audioResponse = null;
            let imageResponse = null;

            // Handle /tts command
            if (incomingText.toLowerCase() === "/tts") {
                ttsModeActive[remoteJid] = true;
                replyText = "TTS mode activated. Please send the text you want to convert to speech.";
            } 
            // Handle /voices command
            else if (incomingText.toLowerCase() === "/voices") {
                let voicesList = "Available voices:\n";
                geminiVoices.forEach(voice => {
                    voicesList += `${voice.id}. ${voice.description}\n`;
                });
                voicesList += "Reply with the number of the voice you want to select (e.g., '1' for Female Voice).";
                replyText = voicesList;
            }
            // Handle voice selection after /voices command
            else if (Object.values(geminiVoices).some(voice => voice.id.toString() === incomingText.toLowerCase())) {
                const selectedVoice = geminiVoices.find(voice => voice.id.toString() === incomingText.toLowerCase());
                if (selectedVoice) {
                    userSelectedVoice[remoteJid] = selectedVoice.name;
                    replyText = `Voice set to: ${selectedVoice.description}.`;
                } else {
                    replyText = "Invalid voice selection. Please choose a number from the list.";
                }
            }
            // Handle /image command
            else if (incomingText.toLowerCase().startsWith("/image")) {
                const imagePrompt = incomingText.substring("/image".length).trim();
                if (imagePrompt) {
                    replyText = "Generating image...";
                    imageResponse = await generateImage(imagePrompt);
                } else {
                    replyText = "Please provide a prompt for the image. Example: /image a cat playing piano";
                }
            }
            // If TTS mode is active, convert incoming text to speech
            else if (ttsModeActive[remoteJid]) {
                const voiceToUse = userSelectedVoice[remoteJid] || 'female_voice';
                audioResponse = await generateAudioFromText(incomingText, voiceToUse);
                replyText = "Here is your text converted to speech.";
                ttsModeActive[remoteJid] = false; // Deactivate TTS mode after one use
            }
            // Handle PDF attachments
            else if (msg.message.documentMessage && msg.message.documentMessage.mimetype === "application/pdf") {
                console.log("Processing PDF document...");
                const buffer = await downloadMediaMessage(msg, "buffer");
                const pdfResult = await extractPdfText(buffer);
                
                if (pdfResult.success && pdfResult.text.length > 0) {
                    const analysis = analyzePdfContent(pdfResult.text, pdfResult.metadata);
                    // Send PDF analysis to Pollinations.ai for a text response
                    const prompt = `Please analyze and summarize this PDF document:\n\n${analysis}\n\nContent preview:\n${pdfResult.text.substring(0, 2000)}...`;
                    replyText = await getPollinationsTextResponse(prompt);
                } else {
                    replyText = pdfResult.summary || "❌ I couldn't extract text from this PDF.";
                }
            }
            // Handle image attachments (for analysis via Gemini)
            else if (msg.message.imageMessage) {
                console.log("Processing image for analysis...");
                const buffer = await downloadMediaMessage(msg, "buffer");
                const mimeType = msg.message.imageMessage.mimetype;
                const imageResult = await processImageForAnalysis(buffer, mimeType);
                
                if (imageResult.success) {
                    const prompt = incomingText || "Please analyze this image in detail.";
                    replyText = await analyzeImageWithGemini(prompt, [imageResult.imagePart]);
                } else {
                    replyText = imageResult.summary || "❌ I couldn't process this image for analysis.";
                }
            }
            // Handle audio/voice messages (transcription via Gemini, response via Pollinations.ai)
            else if (msg.message.audioMessage || msg.message.pttMessage) {
                console.log("Processing audio message...");
                const buffer = await downloadMediaMessage(msg, "buffer");
                const mimeType = msg.message.audioMessage?.mimetype || msg.message.pttMessage?.mimetype || "audio/ogg";
                
                const audioResult = await processAudio(buffer, mimeType);
                
                if (audioResult.success) {
                    // Send transcribed text to Pollinations.ai for response
                    const responseFromPollinations = await getPollinationsTextResponse(audioResult.textResponse);
                    replyText = responseFromPollinations;
                    // Convert Pollinations.ai response to audio using Gemini TTS
                    const voiceToUse = userSelectedVoice[remoteJid] || 'female_voice';
                    audioResponse = await generateAudioFromText(responseFromPollinations, voiceToUse);
                } else {
                    replyText = audioResult.textResponse;
                }
            }
            // Handle text messages (response via Pollinations.ai)
            else if (incomingText) {
                console.log("Processing text message...");
                replyText = await getPollinationsTextResponse(incomingText);
                // If the user's prompt implies TTS, activate TTS mode for the next message
                if (incomingText.toLowerCase().includes("convert text to speech")) {
                    ttsModeActive[remoteJid] = true;
                    replyText += "\nTTS mode activated. Please send the text you want to convert to speech.";
                }
            }
            else {
                replyText = "Hello! I am an AI assistant. How can I assist you today? Try /tts, /voices, or /image.";
            }

            if (replyText) {
                await sock.sendMessage(remoteJid, { text: replyText });
            }

            if (audioResponse) {
                console.log("Sending voice response...");
                await sock.sendMessage(remoteJid, {
                    audio: audioResponse,
                    mimetype: 'audio/mp3',
                    ptt: true
                });
            }

            if (imageResponse) {
                console.log("Sending image response...");
                await sock.sendMessage(remoteJid, {
                    image: { url: imageResponse },
                    caption: "Here is your generated image."
                });
            }
            
            await sock.sendPresenceUpdate("paused", remoteJid);

        } catch (err) {
            console.error("❌ An error occurred in message handler:", err);
            await sock.sendMessage(remoteJid, { 
                text: "❌ Sorry, an unexpected error occurred." 
            });
            await sock.sendPresenceUpdate("paused", remoteJid);
        }
    });
}

// --- Express Server Setup ---
startWhatsApp();

app.use(express.json());
app.use(express.static('public'));

app.get("/qr", (req, res) => {
    if (isConnected) {
        res.send(`<h2>✅ WhatsApp is Connected!</h2>`);
    } else if (qrCodeImage) {
        res.send(`<img src="${qrCodeImage}" alt="WhatsApp QR Code"/>`);
    } else {
        res.send(`<h3>🔄 Generating QR code... Please refresh.</h3>`);
    }
});

app.get("/", (req, res) => {    
    res.send(`<h1>🤖 WhatsApp AI Bot Server is ${isConnected ? 'Running' : 'Disconnected'}</h1>`);    
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
