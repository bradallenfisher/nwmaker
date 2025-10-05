const axios = require('axios');
const AIProvider = require('./AIProvider');

class OpenAIProvider extends AIProvider {
  constructor(apiKey) {
    super(apiKey);
    this.baseURL = 'https://api.openai.com/v1';
    this.model = process.env.OPENAI_MODEL;
  }

  async generateContent(prompt) {
    try {
      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model: this.model,
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
      const data = response.data;

      // Primary: Chat Completions response shape
      if (data?.choices?.[0]?.message?.content) {
        return data.choices[0].message.content;
      }

      // Responses API: output_text shortcut
      if (typeof data?.output_text === 'string') {
        return data.output_text;
      }

      // Responses API: output array content
      const parts = data?.output?.[0]?.content;
      if (Array.isArray(parts)) {
        const text = parts
          .map(p => (typeof p === 'string' ? p : p?.text))
          .filter(Boolean)
          .join('\n');
        if (text) return text;
      }

      throw new Error('Unexpected OpenAI response format');
    } catch (error) {
      console.error('Error generating content with OpenAI:', error);
      throw error;
    }
  }
}

module.exports = OpenAIProvider; 