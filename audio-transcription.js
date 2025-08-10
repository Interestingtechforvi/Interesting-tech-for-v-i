const { transcribeAudioWithGemini, generateSpeech } = require("./gemini-config.js");

/**
 * Process audio message (transcribe and respond)
 * @param {Buffer} buffer - Audio buffer
 * @param {string} mimeType - Audio MIME type
 * @param {string} voice - Voice type for response
 * @returns {Promise<Object>} - Response object with text and audio
 */
async function processAudio(buffer, mimeType, voice = "female") {
    try {
        console.log("Processing audio with Gemini AI for transcription...");
        
        // Transcribe audio using Gemini
        const transcribedText = await transcribeAudioWithGemini(buffer, mimeType);
        
        if (!transcribedText) {
            return { success: false, textResponse: "I'm sorry, I couldn't transcribe the audio." };
        }

        // The text response will now come from Pollinations.ai, so we just return the transcription
        // The main index.js will then send this transcription to Pollinations.ai
        return { success: true, textResponse: transcribedText, audioResponse: null };

    } catch (error) {
        console.error("Error processing audio:", error);
        return {
            success: false,
            textResponse: "❌ Sorry, I couldn't process your audio message. Please try again or send a text message.",
            audioResponse: null,
            error: error.message
        };
    }
}

/**
 * Generate speech from text
 * @param {string} text - Text to convert to speech
 * @param {string} voiceType - Voice type (male/female)
 * @returns {Promise<Buffer>} - Audio buffer
 */
async function generateAudioFromText(text, voiceType) {
    return await generateSpeech(text, voiceType);
}

/**
 * Get transcription service status
 * @returns {Object} - Service status information
 */
function getTranscriptionStatus() {
    return {
        service: "Gemini AI Audio Processing",
        status: "✅ Operational",
        features: {
            transcription: "✅ Available",
            textToSpeech: "✅ Available",
            voiceTypes: ["male", "female"]
        }
    };
}

module.exports = {
    processAudio,
    generateAudioFromText,
    getTranscriptionStatus
};
