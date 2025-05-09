const axios = require('axios');
const AIProvider = require('./AIProvider');

class OpenAIProvider extends AIProvider {
  constructor(apiKey) {
    super(apiKey);
    this.baseURL = 'https://api.openai.com/v1';
  }

  async generateContent(prompt) {
    try {
      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 1
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('Error generating content with OpenAI:', error);
      throw error;
    }
  }
}

module.exports = OpenAIProvider; 