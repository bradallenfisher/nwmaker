const { GoogleGenAI } = require('@google/genai');
const AIProvider = require('./AIProvider');

class GeminiProvider extends AIProvider {
  constructor(apiKey) {
    super(apiKey);
    this.genAI = new GoogleGenAI({ apiKey });
  }

  async generateContent(prompt) {
    try {
      const response = await this.genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt
      });
      return response.text;
    } catch (error) {
      console.error('Error generating content with Gemini:', error);
      throw error;
    }
  }
}

module.exports = GeminiProvider;
