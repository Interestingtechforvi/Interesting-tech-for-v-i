const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require("node-fetch");

// Make sure to set your GEMINI_API_KEY in Render's environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Vision model for image analysis (also used for audio transcription)
const visionModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * Transcribe audio using Gemini API
 * @param {Buffer} audioBuffer - The audio buffer
 * @param {string} mimeType - Audio MIME type
 * @returns {Promise<string>} - Transcribed text
 */
async function transcribeAudioWithGemini(audioBuffer, mimeType) {
    try {
        const audioPart = {
            inlineData: {
                data: audioBuffer.toString("base64"),
                mimeType: mimeType
            }
        };

        const prompt = "Please transcribe this audio message accurately.";
        
        const result = await visionModel.generateContent([prompt, audioPart]); // Using visionModel for audio
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Gemini audio transcription error:", error);
        throw error;
    }
}

/**
 * Generate speech from text using Google Cloud TTS
 * @param {string} text - Text to convert to speech
 * @param {string} voiceType - Voice type (male/female)
 * @returns {Promise<Buffer>} - Audio buffer
 */
async function generateSpeech(text, voiceType = 'female') {
    try {
        const voices = {
            male: {
                languageCode: 'en-US',
                name: 'en-US-Standard-D',
                ssmlGender: 'MALE'
            },
            female: {
                languageCode: 'en-US',
                name: 'en-US-Standard-C', 
                ssmlGender: 'FEMALE'
            }
        };

        const voice = voices[voiceType] || voices.female;
        
        const requestBody = {
            input: { text: text },
            voice: voice,
            audioConfig: {
                audioEncoding: 'MP3',
                speakingRate: 1.0,
                pitch: 0.0
            }
        };

        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody )
        });

        const data = await response.json();
        
        if (data.audioContent) {
            return Buffer.from(data.audioContent, 'base64');
        } else {
            throw new Error('No audio content received from TTS API');
        }
    } catch (error) {
        console.error("TTS Error:", error);
        throw error;
    }
}

/**
 * Analyze image using Gemini Vision API
 * @param {string} prompt - The user's message or prompt
 * @param {Array} imageParts - Image parts for vision API.
 * @returns {Promise<string>} - The AI response
 */
async function analyzeImageWithGemini(prompt, imageParts) {
    try {
        const result = await visionModel.generateContent([prompt, ...imageParts]);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Gemini Image Analysis Error:", error);
        return "❌ Sorry, I'm experiencing technical difficulties with image analysis.";
    }
}

function getModelInfo() {
    return { model: "gemini-1.5-flash", status: "✅ Operational" };
}

module.exports = { 
    getModelInfo, 
    transcribeAudioWithGemini, 
    generateSpeech, 
    analyzeImageWithGemini
};
