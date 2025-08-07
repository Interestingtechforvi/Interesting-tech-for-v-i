require('dotenv').config();
const express = require("express");
const qrcode = require("qrcode");
const pino = require("pino");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs").promises;
const path = require("path");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const mimeTypes = require("mime-types");
const helmet = require("helmet");
const { cleanEnv, str } = require("envalid");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    isJidGroup,
    DisconnectReason,
    downloadMediaMessage,
    getContentType,
} = require("@whiskeysockets/baileys");

// --- Environment Validation ---
const env = cleanEnv(process.env, {
    GEMINI_API_KEY: str(),
    FIREBASE_SERVICE_ACCOUNT: str(),
    PORT: str({ default: "3000" })
});

// --- Configuration ---
const app = express();
app.use(helmet()); // Secure HTTP headers
app.use(express.json({ limit: "10mb" })); // Limit JSON payload size
let qrCodeImage = "";
let isConnected = false;
let sock;
let qrTimeout;

// Logger configuration
const logger = pino({
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    transport: {
        target: "pino-pretty",
        options: { colorize: true }
    }
});

// Initialize Firebase
let db;
try {
    const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
    db = admin.firestore();
    logger.info("Firebase initialized successfully");
} catch (error) {
    logger.error({ err: error }, "Firebase initialization error");
}

// Voice settings for different voices
const VOICE_MODELS = {
    'male1': 'en-US-Journey-D',
    'female1': 'en-US-Journey-F',
    'male2': 'en-US-Studio-M',
    'female2': 'en-US-Studio-O',
    'neutral': 'en-US-Neural2-C'
};

/**
 * Save user data and chat history to Firebase
 */
async function saveUserData(userId, messageData) {
    if (!db) {
        logger.warn("Database not initialized, skipping saveUserData");
        return;
    }
    
    try {
        const userRef = db.collection('users').doc(userId);
        const chatRef = userRef.collection('chats').doc();
        
        await chatRef.set({
            ...messageData,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        await userRef.set({
            lastActive: admin.firestore.FieldValue.serverTimestamp(),
            totalMessages: admin.firestore.FieldValue.increment(1)
        }, { merge: true });
        logger.debug({ userId }, "User data saved");
    } catch (error) {
        logger.error({ err: error, userId }, "Error saving user data");
    }
}

/**
 * Get user's chat history from Firebase
 */
async function getUserHistory(userId, limit = 10) {
    if (!db) {
        logger.warn("Database not initialized, returning empty history");
        return [];
    }
    
    try {
        const chatRef = db.collection('users').doc(userId).collection('chats');
        const snapshot = await chatRef.orderBy('timestamp', 'desc').limit(limit).get();
        
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })).reverse();
    } catch (error) {
        logger.error({ err: error, userId }, "Error getting user history");
        return [];
    }
}

/**
 * Get user preferences (like voice setting)
 */
async function getUserPreferences(userId) {
    if (!db) {
        logger.warn("Database not initialized, returning default preferences");
        return { voice: 'neutral' };
    }
    
    try {
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data();
        
        return {
            voice: userData?.preferences?.voice || 'neutral',
            ...userData?.preferences
        };
    } catch (error) {
        logger.error({ err: error, userId }, "Error getting user preferences");
        return { voice: 'neutral' };
    }
}

/**
 * Update user preferences
 */
async function updateUserPreferences(userId, preferences) {
    if (!db) {
        logger.warn("Database not initialized, skipping updateUserPreferences");
        return;
    }
    
    try {
        await db.collection('users').doc(userId).set({
            preferences: preferences,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        logger.debug({ userId, preferences }, "User preferences updated");
    } catch (error) {
        logger.error({ err: error, userId }, "Error updating user preferences");
    }
}

/**
 * Generate response using Gemini AI with context
 */
async function getChatResponse(text, userId, context = []) {
    try {
        const history = await getUserHistory(userId, 5);
        
        let contextPrompt = "You are a helpful AI assistant. ";
        
        if (history.length > 0) {
            contextPrompt += "Previous conversation context:\n";
            history.forEach(item => {
                if (item.userMessage) contextPrompt += `User: ${item.userMessage}\n`;
                if (item.botResponse) contextPrompt += `Assistant: ${item.botResponse}\n`;
            });
            contextPrompt += "\nNow respond to the current message:\n";
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(contextPrompt + text);
        const responseText = result.response.text();

        await saveUserData(userId, {
            userMessage: text,
            botResponse: responseText,
            type: 'text'
        });

        return responseText;
    } catch (error) {
        logger.error({ err: error, userId, text }, "Error with Gemini API");
        return "I apologize, but I'm experiencing some technical difficulties. Please try again later.";
    }
}

/**
 * Transcribe audio using Gemini AI
 */
async function transcribeAudio(audioBuffer, mimeType) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const audioPart = {
            inlineData: {
                data: audioBuffer.toString('base64'),
                mimeType: mimeType
            }
        };

        const result = await model.generateContent([
            "Please transcribe the following audio accurately:",
            audioPart
        ]);
        
        return result.response.text();
    } catch (error) {
        logger.error({ err: error }, "Error transcribing audio");
        return "Sorry, I couldn't transcribe the audio. Please try again.";
    }
}

/**
 * Analyze image/document using Gemini Vision
 */
async function analyzeMedia(mediaBuffer, mimeType, prompt = "Describe what you see in this image/document") {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const mediaPart = {
            inlineData: {
                data: mediaBuffer.toString('base64'),
                mimeType: mimeType
            }
        };

        const result = await model.generateContent([prompt, mediaPart]);
        return result.response.text();
    } catch (error) {
        logger.error({ err: error }, "Error analyzing media");
        return "Sorry, I couldn't analyze the media. Please try again.";
    }
}

/**
 * Convert text to speech using Google Cloud TTS
 */
async function textToSpeech(text, userId) {
    try {
        const userPrefs = await getUserPreferences(userId);
        const voiceModel = VOICE_MODELS[userPrefs.voice] || VOICE_MODELS.neutral;
        
        const response = await axios.post(
            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.GEMINI_API_KEY}`,
            {
                input: { text: text },
                voice: {
                    languageCode: 'en-US',
                    name: voiceModel
                },
                audioConfig: {
                    audioEncoding: 'MP3'
                }
            },
            { timeout: 10000 } // Add timeout for API call
        );

        return Buffer.from(response.data.audioContent, 'base64');
    } catch (error) {
        logger.error({ err: error, userId }, "Error with text-to-speech");
        return null;
    }
}

/**
 * Process different types of media messages
 */
async function processMediaMessage(msg, mediaType) {
    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { maxBufferSize: 10 * 1024 * 1024 }); // Limit buffer size to 10MB
        const mimeType = getContentType(msg.message);
        
        let response = "";
        
        if (mediaType === 'image') {
            response = await analyzeMedia(buffer, mimeType, "Analyze this image and describe what you see. If there's text, please transcribe it.");
        } else if (mediaType === 'document') {
            response = await analyzeMedia(buffer, mimeType, "Extract and summarize the content of this document.");
        } else if (mediaType === 'audio') {
            response = await transcribeAudio(buffer, mimeType);
        } else if (mediaType === 'video') {
            try {
                response = await analyzeMedia(buffer, mimeType, "Describe what happens in this video.");
            } catch (error) {
                logger.warn({ err: error }, "Video processing not supported, falling back to basic response");
                response = "Video processing is not fully supported in this environment.";
            }
        }

        return response;
    } catch (error) {
        logger.error({ err: error, mediaType }, `Error processing ${mediaType}`);
        return `Sorry, I couldn't process the ${mediaType}. Please try again.`;
    }
}

/**
 * Handle special commands
 */
async function handleCommand(command, userId, sock, remoteJid) {
    const cmd = command.toLowerCase().trim();
    
    if (cmd.startsWith('/voice ')) {
        const voiceType = cmd.split(' ')[1];
        if (VOICE_MODELS[voiceType]) {
            await updateUserPreferences(userId, { voice: voiceType });
            return `Voice changed to ${voiceType}. Your next text-to-speech will use this voice.`;
        } else {
            return `Available voices: ${Object.keys(VOICE_MODELS).join(', ')}`;
        }
    } else if (cmd === '/voices') {
        return `Available voices: ${Object.keys(VOICE_MODELS).join(', ')}\nUse /voice [voice_name] to change your voice.`;
    } else if (cmd === '/tts' || cmd === '/speak') {
        return "Please send me text after this command, like: /tts Hello, how are you?";
    } else if (cmd.startsWith('/tts ') || cmd.startsWith('/speak ')) {
        const textToSpeak = command.substring(cmd.startsWith('/tts') ? 5 : 7).trim();
        if (!textToSpeak) {
            return "Please provide text to convert to speech.";
        }
        const audioBuffer = await textToSpeech(textToSpeak, userId);
        
        if (audioBuffer) {
            await sock.sendMessage(remoteJid, {
                audio: audioBuffer,
                mimetype: 'audio/mp4',
                ptt: true
            });
            return null;
        } else {
            return "Sorry, I couldn't generate the voice message. Please try again.";
        }
    } else if (cmd === '/clear' || cmd === '/reset') {
        if (db) {
            try {
                const chatRef = db.collection('users').doc(userId).collection('chats');
                const snapshot = await chatRef.get();
                
                const batch = db.batch();
                snapshot.docs.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
                
                return "Your chat history has been cleared. Starting fresh!";
            } catch (error) {
                logger.error({ err: error, userId }, "Error clearing history");
                return "Sorry, I couldn't clear your history. Please try again.";
            }
        }
        return "Chat history cleared (local session only).";
    }
    
    return null;
}

// --- Main WhatsApp Bot Logic ---
async function startWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState("auth_info_multi");
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: state,
            logger,
            qrTimeout: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 30000,
            generateHighQualityLinkPreview: true,
        });

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                try {
                    qrCodeImage = await qrcode.toDataURL(qr, { margin: 2 });
                    logger.info("New QR Code generated");
                    // Clear QR code after 60 seconds
                    if (qrTimeout) clearTimeout(qrTimeout);
                    qrTimeout = setTimeout(() => {
                        qrCodeImage = "";
                        logger.info("QR code cleared due to timeout");
                    }, 60000);
                } catch (error) {
                    logger.error({ err: error }, "Error generating QR code");
                }
            }
            
            if (connection === "open") {
                isConnected = true;
                qrCodeImage = "";
                clearTimeout(qrTimeout);
                logger.info("WhatsApp Connected Successfully!");
            } else if (connection === "close") {
                isConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                
                logger.info({ statusCode }, "Connection closed");
                
                if (statusCode !== DisconnectReason.loggedOut) {
                    logger.info("Reconnecting...");
                    setTimeout(startWhatsApp, 5000);
                } else {
                    logger.warn("Logged out, scan QR again");
                    qrCodeImage = "";
                }
            }
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("messages.upsert", async ({ messages }) => {
            for (const msg of messages) {
                if (!msg.message || msg.key.fromMe || isJidGroup(msg.key.remoteJid)) {
                    continue;
                }

                const remoteJid = msg.key.remoteJid;
                const userId = remoteJid.replace('@s.whatsapp.net', '');
                
                try {
                    await sock.readMessages([msg.key]);
                    await sock.sendPresenceUpdate('composing', remoteJid);

                    let responseText = "";
                    let mediaProcessed = false;

                    if (msg.message.conversation || msg.message.extendedTextMessage?.text) {
                        const incomingText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
                        
                        if (incomingText.startsWith('/')) {
                            const commandResponse = await handleCommand(incomingText, userId, sock, remoteJid);
                            if (commandResponse) {
                                responseText = commandResponse;
                            } else {
                                continue;
                            }
                        } else {
                            responseText = await getChatResponse(incomingText, userId);
                        }
                    } else if (msg.message.imageMessage) {
                        responseText = await processMediaMessage(msg, 'image');
                        mediaProcessed = true;
                    } else if (msg.message.documentMessage) {
                        responseText = await processMediaMessage(msg, 'document');
                        mediaProcessed = true;
                    } else if (msg.message.audioMessage) {
                        responseText = await processMediaMessage(msg, 'audio');
                        mediaProcessed = true;
                    } else if (msg.message.videoMessage) {
                        responseText = await processMediaMessage(msg, 'video');
                        mediaProcessed = true;
                    }

                    if (mediaProcessed) {
                        await saveUserData(userId, {
                            userMessage: '[Media Message]',
                            botResponse: responseText,
                            type: 'media'
                        });
                    }

                    if (responseText) {
                        await sock.sendMessage(remoteJid, { text: responseText });
                    }

                    await sock.sendPresenceUpdate('paused', remoteJid);
                } catch (err) {
                    logger.error({ err, userId, remoteJid }, "Message handling error");
                    await sock.sendMessage(remoteJid, {
                        text: "❌ Sorry, I encountered an error. Please try again."
                    });
                    await sock.sendPresenceUpdate('paused', remoteJid);
                }
            }
        });
    } catch (error) {
        logger.error({ err: error }, "Error starting WhatsApp bot");
        setTimeout(startWhatsApp, 5000);
    }
}

// --- Express Server Routes ---
app.get("/qr", (req, res) => {
    if (isConnected) {
        res.send(`
            <div style="text-align: center; padding: 50px; background: #0d1117; color: white; min-height: 100vh;">
                <h1>✅ WhatsApp Bot Connected</h1>
                <p>Your bot is ready to receive messages!</p>
                <div style="margin-top: 30px;">
                    <h3>Available Commands:</h3>
                    <ul style="list-style: none; padding: 0;">
                        <li>/voices - Show available voice options</li>
                        <li>/voice [voice_name] - Change TTS voice</li>
                        <li>/tts [text] - Convert text to speech</li>
                        <li>/speak [text] - Same as /tts</li>
                        <li>/clear - Clear chat history</li>
                    </ul>
                </div>
            </div>
        `);
    } else if (qrCodeImage) {
        res.send(`
            <div style="text-align: center; padding: 50px; background: #0d1117; color: white; min-height: 100vh;">
                <h1>📱 Scan QR Code</h1>
                <div style="background: white; padding: 20px; border-radius: 15px; display: inline-block; margin: 20px;">
                    <img src="${qrCodeImage}" alt="WhatsApp QR Code" style="width: 300px; height: 300px;"/>
                </div>
                <p>Scan this QR code with WhatsApp to connect your bot</p>
                <p><small>This page will refresh automatically when connected</small></p>
                <script>
                    setTimeout(() => window.location.reload(), 5000);
                </script>
            </div>
        `);
    } else {
        res.send(`
            <div style="text-align: center; padding: 50px; background: #0d1117; color: white; min-height: 100vh;">
                <h1>⏳ Generating QR Code...</h1>
                <p>Please wait while we generate your QR code...</p>
                <script>
                    setTimeout(() => window.location.reload(), 3000);
                </script>
            </div>
        `);
    }
});

app.get("/", (req, res) => {
    const status = isConnected ? '✅ Connected' : '❌ Disconnected';
    res.send(`
        <div style="text-align: center; padding: 50px; background: #0d1117; color: white; min-height: 100vh;">
            <h1>🤖 WhatsApp AI Bot</h1>
            <h2>Status: ${status}</h2>
            <p>Powered by Gemini AI</p>
            <div style="margin: 30px 0;">
                <a href="/qr" style="background: #00d4aa; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; font-weight: bold;">
                    Get QR Code
                </a>
            </div>
            <div style="margin-top: 40px; text-align: left; max-width: 600px; margin-left: auto; margin-right: auto;">
                <h3>🌟 Features:</h3>
                <ul>
                    <li>💬 Smart AI chat with context memory</li>
                    <li>🎤 Voice message transcription</li>
                    <li>🔊 Text-to-speech with multiple voices</li>
                    <li>📷 Image analysis and OCR</li>
                    <li>📄 Document processing</li>
                    <li>🎥 Video analysis (limited support)</li>
                    <li>💾 Chat history storage</li>
                    <li>🔄 Session restoration</li>
                </ul>
            </div>
        </div>
    `);
});

app.get("/health", (req, res) => {
    res.json({ status: "healthy", connected: isConnected });
});

// Global error handler
app.use((err, req, res, next) => {
    logger.error({ err, path: req.path }, "Express error");
    res.status(500).json({ error: "Internal server error" });
});

// Start the application
async function startApp() {
    try {
        await startWhatsApp();
        const PORT = env.PORT;
        app.listen(PORT, () => {
            logger.info(`Server running on port ${PORT}`);
            logger.info(`QR Code: http://localhost:${PORT}/qr`);
            logger.info(`Dashboard: http://localhost:${PORT}/`);
        });
    } catch (error) {
        logger.error({ err: error }, "Failed to start application");
        process.exit(1);
    }
}

startApp();