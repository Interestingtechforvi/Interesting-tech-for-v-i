const pdf = require("pdf-parse");
const axios = require("axios");
const { analyzeImageWithGemini } = require("./gemini-config.js");

/**
 * Extract text from PDF buffer
 * @param {Buffer} buffer - The PDF buffer
 * @returns {Promise<Object>} - Extracted text and metadata
 */
async function extractPdfText(buffer) {
    try {
        const data = await pdf(buffer);
        return { success: true, text: data.text, metadata: data.metadata };
    } catch (error) {
        console.error("Error extracting PDF text:", error);
        return { success: false, summary: "Could not read text from the PDF." };
    }
}

/**
 * Analyze PDF content and generate summary
 * @param {string} text - Extracted PDF text
 * @param {Object} metadata - PDF metadata
 * @returns {string} - Content analysis summary
 */
function analyzePdfContent(text, metadata) {
    return `Document with ${metadata.PDFFormatVersion} format, ${metadata.Pages} pages.`;
}

/**
 * Process image for Gemini Vision API (for analysis)
 * @param {Buffer} buffer - Image buffer
 * @param {string} mimetype - Image MIME type
 * @returns {Promise<Object>} - Processed image data for Gemini
 */
async function processImageForAnalysis(buffer, mimetype) {
    try {
        const imagePart = {
            inlineData: {
                data: buffer.toString("base64"),
                mimeType: mimetype,
            },
        };
        return { success: true, imagePart };
    } catch (error) {
        console.error("Error processing image for analysis:", error);
        return { success: false, summary: "Could not process the image for analysis." };
    }
}

/**
 * Generate image using Pollinations.ai
 * @param {string} prompt - The prompt for image generation
 * @returns {Promise<string>} - URL of the generated image
 */
async function generateImage(prompt) {
    try {
        const encodedPrompt = encodeURIComponent(prompt);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}`;
        return imageUrl;
    } catch (error ) {
        console.error("Error generating image from Pollinations.ai:", error);
        return null;
    }
}

function getMediaProcessingStatus() {
    return { pdf: "✅ Operational", imageAnalysis: "✅ Operational", imageGeneration: "✅ Operational" };
}

module.exports = { 
    extractPdfText, 
    analyzePdfContent, 
    processImageForAnalysis, 
    generateImage, 
    getMediaProcessingStatus, 
    analyzeImageWithGemini 
};
