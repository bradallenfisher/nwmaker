// Abstract base class for AI providers
class AIProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async generateContent(prompt) {
    throw new Error('generateContent must be implemented by subclass');
  }
}

module.exports = AIProvider;
