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
 * @param {string} voiceType - Voice type (e.g., 'Kore', 'Zephyr', 'male_voice', 'female_voice')
 * @returns {Promise<Buffer>} - Audio buffer
 */
async function generateSpeech(text, voiceType = 'female_voice') {
    try {
        // Mapping from user-friendly names to Google Cloud TTS voice names
        const voiceMap = {
            'Kore': { languageCode: 'en-US', name: 'en-US-Neural2-J', ssmlGender: 'FEMALE' }, // Example mapping
            'Zephyr': { languageCode: 'en-US', name: 'en-US-Neural2-G', ssmlGender: 'FEMALE' },
            'Puck': { languageCode: 'en-US', name: 'en-US-Neural2-F', ssmlGender: 'FEMALE' },
            'Charon': { languageCode: 'en-US', name: 'en-US-Neural2-H', ssmlGender: 'FEMALE' },
            'Fenrir': { languageCode: 'en-US', name: 'en-US-Neural2-C', ssmlGender: 'FEMALE' },
            'Leda': { languageCode: 'en-US', name: 'en-US-Neural2-A', ssmlGender: 'FEMALE' },
            'Orus': { languageCode: 'en-US', name: 'en-US-Neural2-B', ssmlGender: 'MALE' },
            'Aoede': { languageCode: 'en-US', name: 'en-US-Neural2-D', ssmlGender: 'MALE' },
            'Callirrhoe': { languageCode: 'en-US', name: 'en-US-Neural2-E', ssmlGender: 'MALE' },
            'Autonoe': { languageCode: 'en-US', name: 'en-US-Neural2-I', ssmlGender: 'MALE' },
            'Enceladus': { languageCode: 'en-US', name: 'en-US-Wavenet-F', ssmlGender: 'FEMALE' },
            'Iapetus': { languageCode: 'en-US', name: 'en-US-Wavenet-G', ssmlGender: 'FEMALE' },
            'Umbriel': { languageCode: 'en-US', name: 'en-US-Wavenet-H', ssmlGender: 'FEMALE' },
            'Algieba': { languageCode: 'en-US', name: 'en-US-Wavenet-I', ssmlGender: 'FEMALE' },
            'Despina': { languageCode: 'en-US', name: 'en-US-Wavenet-J', ssmlGender: 'FEMALE' },
            'Erinome': { languageCode: 'en-US', name: 'en-US-Wavenet-K', ssmlGender: 'FEMALE' },
            'Algenib': { languageCode: 'en-US', name: 'en-US-Wavenet-L', ssmlGender: 'MALE' },
            'Rasalgethi': { languageCode: 'en-US', name: 'en-US-Wavenet-M', ssmlGender: 'MALE' },
            'Laomedeia': { languageCode: 'en-US', name: 'en-US-Wavenet-N', ssmlGender: 'MALE' },
            'Achernar': { languageCode: 'en-US', name: 'en-US-Wavenet-O', ssmlGender: 'MALE' },
            'Alnilam': { languageCode: 'en-US', name: 'en-US-Wavenet-P', ssmlGender: 'MALE' },
            'Schedar': { languageCode: 'en-US', name: 'en-US-Wavenet-Q', ssmlGender: 'MALE' },
            'Gacrux': { languageCode: 'en-US', name: 'en-US-Wavenet-R', ssmlGender: 'MALE' },
            'Pulcherrima': { languageCode: 'en-US', name: 'en-US-Wavenet-S', ssmlGender: 'FEMALE' },
            'Achird': { languageCode: 'en-US', name: 'en-US-Wavenet-T', ssmlGender: 'FEMALE' },
            'Zubenelgenubi': { languageCode: 'en-US', name: 'en-US-Wavenet-U', ssmlGender: 'FEMALE' },
            'Vindematrix': { languageCode: 'en-US', name: 'en-US-Wavenet-V', ssmlGender: 'FEMALE' },
            'Sadachbia': { languageCode: 'en-US', name: 'en-US-Wavenet-W', ssmlGender: 'MALE' },
            'Sadaltager': { languageCode: 'en-US', name: 'en-US-Wavenet-X', ssmlGender: 'MALE' },
            'Sulafat': { languageCode: 'en-US', name: 'en-US-Wavenet-Y', ssmlGender: 'MALE' },
            'male_voice': { languageCode: 'en-US', name: 'en-US-Standard-D', ssmlGender: 'MALE' }, // Default male
            'female_voice': { languageCode: 'en-US', name: 'en-US-Standard-C', ssmlGender: 'FEMALE' } // Default female
        };

        const voiceConfig = voiceMap[voiceType] || voiceMap['female_voice']; // Default to female_voice if not found
        
        const requestBody = {
            input: { text: text },
            voice: voiceConfig,
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
