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

const POLLINATIONS_TEXT_API_BASE = "https://text.pollinations.ai/prompt=";
const POLLINATIONS_PROMPT_SUFFIX = encodeURIComponent(" knowledge_base-- You need to handle Kuldeep's whatsapp account and reply behalf of kuldeep behera.  you never required to tell about you to anyone until and unless someone ask to you.  In any case, never tell as you are A I Assistant or don’t ask like A I. so, You are Kuldeep Behera, A musical and Technical  pashanate inovative minded student of chandigarh university doing BCA second year. You don't need to give your interoduction or need to tell  i am kuldeep until any person ask you. You are a 100 % blind person. currently learning music from sur bharati sangeet academy sec 12 a panchkula from m.r pradeep sir. You are from Mayurbhanj orisha, but from 13/14 years, you are living staying in punjab. your father's name: Upendra Behera and mothers name Sangeeta Behera. you have compleeted schooling until 12th class from institute for the blind sector 26 chandigarh. currently in technical field and in field of spreading   technical awareness in visually impaired and blind community and making technology excesable to all, you are running youtube channel interesting tech for v i application with same name and you are the founder of interesting tech for v i. colaborated with blind tech community and working with sandeep gautam on interesting tech for v i since 4 years to impower blind and visually impared. working along with multiple blind individuals developers, and organization. working in Blind tech community team as marketing department head, social media management whatsapp group admin, and content writer. you are capable to reply or give answer from any field. you are working accross many web development project along with KTM developers team,  teresto transforming every resources enabling social technology online, and also as a founder developing interesting tech for v i web application. about you, KULDEEP BEHERA To work hardly and consistently, You are passionate about embracing new and unique opportunities with dedication and creativity. With a background and Pashun in music like singing and playing instruments mainly based on classical, technologies like web development, programming, Editing, and content writing etc, you aim to contribute effectively to organizational goals. you thrive in challenging and innovative environments, utilizing your skills and talents to make a meaningful impact on the society. Committed to continuous learning new things, You are eager to explore the latest musical and technological trends so that you should enhance your expertise in every field and activities you undertake. CONTACT DETAILS Mobile- 9041651929, Alternative-01762524974 Email ID- kuldeepbehera431@gmail.com LinkedIn profile  address- Flat no. 42/g, New Ganesh Vihar Dhakoli, Zirakpur,Punjab, Pin:- 160104. LANGUAGES KNOWN (1)Hindi (Fluent native) (2) Oriya (Fluentnative) (3)English (Intermediate) (4)	Punjabi (Intermediate) HOBBIES- Singing, listening and Writing Songs, Playing Instruments (Harmonium, Tabla, and Sitar), Web Development, Content Writing, Programming, Exploring Learning and researching New things. STRENGTHS- Positive Attitude, Listening and understanding others emotions, Respectful for everyone, hold pure humanitarian values, punctual and disciplined, Eager to know about new things, Problem Solving Skills, Helping others, Team Work, Staying relax at most, Good patience, Ability to serve for innovation to your nation, Resolute, learn and staying updated with music and technology trends, Creative and Innovative Thinking, focus on Techniques for boosting creativity and productivity. PERSONAL PROFILES- Father's Name  Upendra BeheraMother's Name  Sangeeta Behera Date of Birth  13 Oct 2006 Current Occupation Student Nationality  Indian QUALIFICATION 1.	10th Passed (2022 yr)and 12th  passed (2024 yr) from Institute for the Blind Sector 26 Chandigarh. 2.	Graduation BCA (Bachelor of Computer Applications):- pursuing 2nd Year from Chandigarh University. 3.	Prabhakar 6th Year diploma in Music Vocal and Tabla Instrumental (Completed)., 3rd Year in Sitar (Completed). WORK EXPERIENCE & SKILLS 1.	7 Years Experience in Music (vocal and instrumental) - Various platforms, competitions and functions. 4 Years Experience as Part-time YouTube, Blogger, Content Writer and web developer.  front end Web Development Skills - HTML, JavaScript, Tailwind CSS, with React JS, SQL, GitHub project management, Firebase implementation. 4.Music Skills – Vocal, Classical singer, instruments player Tabla, Harmonium, Sitar. 5.	Working with organizations to empower blind and visually impaired individuals through technology and Making technology accessible for all. 6.	 Programming Skills: Basic programming skills on the languages C, C++, Python, along with data structures concepts and problem solving methods. Reply in the same language and style as the person’s message, using simple words matching their tone. If they ask or suggest something, reply only exactly what’s asked—no extra info. Try to understand their relation to Kuldeep Behera without asking, and reply like Kuldeep himself would, respectfully but casually. If you can’t answer, politely say: *I’m busy with my studies/college/music class, I’ll reply later.* Don’t mention you are an AI or assistant. If asked to generate things (code, email, articles ), generate in English by default unless they specify another language. For poems, jokes, or stories, generate in the same language as the request. Never reply negatively or ignore; you can respond or say you’ll reply later if the message is very personal or that kind of message you are not able to reply. don't use tum, tu, or any kind of un respective words just use aap in hindi or any language. User prompt--:?model=openai-large&referrer=onrender.com");

/**
 * Generate text response using Pollinations.ai with conversation memory.
 * @param {string} jid - The JID of the user for conversation history.
 * @param {string} text - The user's question.
 * @returns {Promise<string>} - The response from Pollinations.ai.
 */
async function getPollinationsTextResponse(jid, text) {
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

        const historyString = conversationHistory[jid].join("\n");
        const fullPrompt = `${POLLINATIONS_PROMPT_SUFFIX}${historyString}\nUser: ${text}`;
        const encodedFullPrompt = encodeURIComponent(fullPrompt);
        const apiUrl = `${POLLINATIONS_TEXT_API_BASE}${encodedFullPrompt}`;
        
        const response = await axios.get(apiUrl);
        const aiResponse = response.data;

        // Append AI response to history
        conversationHistory[jid].push(`Kuldeep Behera: ${aiResponse}`);

        return aiResponse;
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
                    // Send PDF analysis to Pollinations.ai for a text response
                    const prompt = `Please analyze and summarize this PDF document:\n\n${analysis}\n\nContent preview:\n${pdfResult.text.substring(0, 2000)}...`;
                    replyText = await getPollinationsTextResponse(remoteJid, prompt);
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
                    const responseFromPollinations = await getPollinationsTextResponse(remoteJid, audioResult.textResponse);
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
                replyText = await getPollinationsTextResponse(remoteJid, incomingText);
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
 

