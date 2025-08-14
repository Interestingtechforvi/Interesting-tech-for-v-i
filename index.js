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

// State variables for commands and conversation memory
let ttsModeActive = {}; // Stores JID for users in TTS mode
let userSelectedVoice = {}; // Stores selected voice for each JID
let conversationHistory = {}; // Stores conversation history for each JID

const geminiVoices = [
    { id: 1, name: "Kore", description: "Kore - Firm" },
    { id: 2, name: "Zephyr", description: "Zephyr - Bright" },
    { id: 3, name: "Puck", description: "Puck - Upbeat" },
    { id: 4, name: "Charon", description: "Charon - Informative" },
    { id: 5, name: "Fenrir", description: "Fenrir - Excitable" },
    { id: 6, name: "Leda", description: "Leda - Youthful" },
    { id: 7, name: "Orus", description: "Orus - Firm" },
    { id: 8, name: "Aoede", description: "Aoede - Breezy" },
    { id: 9, name: "Callirrhoe", description: "Callirrhoe - Easy-going" },
    { id: 10, name: "Autonoe", description: "Autonoe - Bright" },
    { id: 11, name: "Enceladus", description: "Enceladus - Breathy" },
    { id: 12, name: "Iapetus", description: "Iapetus - Clear" },
    { id: 13, name: "Umbriel", description: "Umbriel - Easy-going" },
    { id: 14, name: "Algieba", description: "Algieba - Smooth" },
    { id: 15, name: "Despina", description: "Despina - Smooth" },
    { id: 16, name: "Erinome", description: "Erinome - Clear" },
    { id: 17, name: "Algenib", description: "Algenib - Gravelly" },
    { id: 18, name: "Rasalgethi", description: "Rasalgethi - Informative" },
    { id: 19, name: "Laomedeia", description: "Laomedeia - Upbeat" },
    { id: 20, name: "Achernar", description: "Achernar - Soft" },
    { id: 21, name: "Alnilam", description: "Alnilam - Firm" },
    { id: 22, name: "Schedar", description: "Schedar - Even" },
    { id: 23, name: "Gacrux", description: "Gacrux - Mature" },
    { id: 24, name: "Pulcherrima", description: "Pulcherrima - Forward" },
    { id: 25, name: "Achird", description: "Achird - Friendly" },
    { id: 26, name: "Zubenelgenubi", description: "Zubenelgenubi - Casual" },
    { id: 27, name: "Vindematrix", description: "Vindematrix - Gentle" },
    { id: 28, name: "Sadachbia", description: "Sadachbia - Lively" },
    { id: 29, name: "Sadaltager", description: "Sadaltager - Knowledgeable" },
    { id: 30, name: "Sulafat", description: "Sulafat - Warm" }
];

const ASHLYNN_AI_API_BASE = "https://ai.ashlynn.workers.dev/ask";
const SYSTEM_PROMPT = encodeURIComponent("Reply only without additional contexts or questions if not required. You are capable to answer any question from any field. You are Kuldeep Behera, born 13 Oct 2006, a 100% blind BCA 2nd year student at Chandigarh University, passionate about music and technology. You study music at Sur Bharati Sangeet Academy and run the YouTube channel \"Interesting Tech for VI\" to empower visually impaired via tech. From Mayurbhanj Oriya, living in Punjab for 13+ years. Parents: Upendra and Sangeeta Behera. Completed 12th at Institute for the Blind Chandigarh. Skilled in web dev (HTML, JS, React, Tailwind, SQL ), programming (C, C++, Python basics), music (vocal, tabla, harmonium, sitar), content writing, and community work (Blind Tech Community marketing head). You collaborate with developers and run web projects to make tech accessible to the blind. Fluent in Hindi, Oriya; intermediate English and Punjabi. Hobbies: singing, songwriting, instruments, programming, learning. Positive, respectful, creative, disciplined, patient. Reply politely, like Kuldeep would, no mention of AI or assistant role. If asked about personal/emotional/short-term plans, say you’ll reply later as busy with studies/music. Generate content in English unless told otherwise. Always provide accurate, verified info and keep replies concise without additional contexts.");

/**
 * Generate text response using ai.ashlynn.workers.dev with conversation memory.
 * @param {string} jid - The JID of the user for conversation history.
 * @param {string} text - The user's question.
 * @returns {Promise<string>} - The response from ai.ashlynn.workers.dev.
 */
async function getAshlynnAITextResponse(jid, text) {
    try {
        // Initialize history for the JID if it doesn't exist
        if (!conversationHistory[jid]) {
            conversationHistory[jid] = [];
        }

        // Append current message to history
        conversationHistory[jid].push(`User: ${text}`);

        // Keep history to a reasonable length (e.g., last 5 exchanges)
        if (conversationHistory[jid].length > 10) {
            conversationHistory[jid] = conversationHistory[jid].slice(-10);
        }

        const historyString = conversationHistory[jid].map(entry => `\n${entry}`).join("");
        const userPrompt = encodeURIComponent(`Previous conversation:${historyString}\nPrompt:${text}`);
        
        const apiUrl = `${ASHLYNN_AI_API_BASE}?prompt=System%20prompt:%20${SYSTEM_PROMPT}%20*%20user%20prompt:%20${userPrompt}&model=Perplexity%20AI`;
        
        const response = await axios.get(apiUrl);
        const aiResponse = response.data.response; // Assuming the response is in a 'response' field

        // Append AI response to history
        conversationHistory[jid].push(`Kuldeep Behera: ${aiResponse}`);

        return aiResponse;
    } catch (error) {
        console.error("Ashlynn AI text API error:", error);
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
                voicesList += "Reply with the number of the voice you want to select (e.g., '1' for Kore - Firm).";
                replyText = voicesList;
            }
            // Handle voice selection after /voices command
            else if (geminiVoices.some(voice => voice.id.toString() === incomingText.toLowerCase())) {
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
                    // Send PDF analysis to Ashlynn AI for a text response
                    const prompt = `Please analyze and summarize this PDF document:\n\n${analysis}\n\nContent preview:\n${pdfResult.text.substring(0, 2000)}...`;
                    replyText = await getAshlynnAITextResponse(remoteJid, prompt);
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
            // Handle audio/voice messages (transcription via Gemini, response via Ashlynn AI)
            else if (msg.message.audioMessage || msg.message.pttMessage) {
                console.log("Processing audio message...");
                const buffer = await downloadMediaMessage(msg, "buffer");
                const mimeType = msg.message.audioMessage?.mimetype || msg.message.pttMessage?.mimetype || "audio/ogg";
                
                const audioResult = await processAudio(buffer, mimeType);
                
                if (audioResult.success) {
                    // Send transcribed text to Ashlynn AI for response
                    const responseFromAshlynn = await getAshlynnAITextResponse(remoteJid, audioResult.textResponse);
                    replyText = responseFromAshlynn;
                    // Convert Ashlynn AI response to audio using Gemini TTS
                    const voiceToUse = userSelectedVoice[remoteJid] || 'female_voice';
                    audioResponse = await generateAudioFromText(responseFromAshlynn, voiceToUse);
                } else {
                    replyText = audioResult.textResponse;
                }
            }
            // Handle text messages (response via Ashlynn AI)
            else if (incomingText) {
                console.log("Processing text message...");
                replyText = await getAshlynnAITextResponse(remoteJid, incomingText);
                // If the user's prompt implies TTS, activate TTS mode for the next message
                if (incomingText.toLowerCase().includes("convert text to speech")) {
                    ttsModeActive[remoteJid] = true;
                    replyText += "\nTTS mode activated. Please send the text you want to convert to speech.";
                }
            }
            else {
                replyText = "Hello! I am Kuldeep Behera. How can I assist you today? Try /tts, /voices, or /image.";
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
