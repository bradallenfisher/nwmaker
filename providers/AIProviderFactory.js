const GeminiProvider = require('./GeminiProvider');
const OpenAIProvider = require('./OpenAIProvider');

class AIProviderFactory {
  static createProvider(type, apiKey) {
    switch (type.toLowerCase()) {
      case 'gemini':
        return new GeminiProvider(apiKey);
      case 'openai':
        return new OpenAIProvider(apiKey);
      default:
        throw new Error(`Unknown AI provider type: ${type}`);
    }
  }
}

module.exports = AIProviderFactory; 