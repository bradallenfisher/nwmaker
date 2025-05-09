const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');
const { marked } = require('marked');
const AIProviderFactory = require('./providers/AIProviderFactory');

dotenv.config();

/**
 * QuestionsGenerator class processes questions from NeuronWriter data
 * and generates blog posts that answer each question
 */
class QuestionsGenerator {
  constructor(aiProviderType, aiProviderKey) {
    this.aiProvider = AIProviderFactory.createProvider(aiProviderType, aiProviderKey);
  }

  /**
   * Ensures all necessary directories exist
   */
  async ensureDirectories() {
    // Only create base directories
    await fs.mkdir('outputs', { recursive: true });
    await fs.mkdir(path.join('outputs', 'questions'), { recursive: true });
    await fs.mkdir(path.join('outputs', 'questions', 'posts'), { recursive: true });
  }

  /**
   * Loads question data from a JSON file
   * @param {string} queryId - The NeuronWriter query ID to load questions for
   * @returns {Object} The questions data
   */
  async loadQuestionsData(queryId) {
    try {
      const questionsPath = path.join('outputs', 'questions', `questions-${queryId}.json`);
      const questionsJson = await fs.readFile(questionsPath, 'utf8');
      return JSON.parse(questionsJson);
    } catch (error) {
      console.error(`Error loading questions data for query ${queryId}:`, error);
      throw error;
    }
  }

  /**
   * Generates a blog post answering a specific question
   * @param {string} question - The question to answer
   * @param {string} keyword - The main keyword related to the question
   * @returns {string} The generated blog post content
   */
  async generateQuestionPost(question, keyword) {
    try {
      // Read question template
      let questionTemplate = await fs.readFile(path.join('inputs', 'prompt-questions.txt'), 'utf8');
      
      // Replace variables in the template
      questionTemplate = questionTemplate
        .replace('{question}', question)
        .replace('{keyword}', keyword);
      
      // Generate content with retries for overloaded model
      const maxRetries = 3;
      const baseDelay = 2000;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await this.aiProvider.generateContent(questionTemplate);
        } catch (error) {
          if (error.message?.includes("overloaded") && attempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.log(`Model overloaded, retrying in ${delay/1000} seconds... (Attempt ${attempt}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      console.error(`Error generating post for question "${question}":`, error);
      throw error;
    }
  }

  /**
   * Processes all questions from a query and generates blog posts for each
   * @param {string} queryId - The NeuronWriter query ID
   */
  async processQueryQuestions(queryId) {
    try {
      // Ensure directories exist
      await this.ensureDirectories();
      
      // Load questions data
      console.log(`Loading questions data for query ${queryId}...`);
      const questionsData = await this.loadQuestionsData(queryId);
      const { keyword, questions } = questionsData;
      
      console.log(`Found ${questions.length} questions for keyword "${keyword}"`);
      
      // Create a directory for this keyword's questions
      const safeKeyword = keyword
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      
      const keywordDir = path.join('outputs', 'questions', 'posts', safeKeyword);
      const mdDir = path.join(keywordDir, 'md');
      const htmlDir = path.join(keywordDir, 'html');
      
      await fs.mkdir(keywordDir, { recursive: true });
      await fs.mkdir(mdDir, { recursive: true });
      await fs.mkdir(htmlDir, { recursive: true });
      
      // Process each question
      for (let i = 0; i < questions.length; i++) {
        const { question, type } = questions[i];
        console.log(`\nProcessing question ${i + 1} of ${questions.length} (${type}):`);
        console.log(`"${question}"`);
        
        // Generate a safe filename
        const safeQuestion = question
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .substring(0, 50); // Limit filename length
        
        // Generate post content
        const markdownContent = await this.generateQuestionPost(question, keyword);
        
        // Convert to HTML
        const htmlContent = marked(markdownContent);
        
        // Save files
        const markdownPath = path.join(mdDir, `${safeQuestion}.md`);
        const htmlPath = path.join(htmlDir, `${safeQuestion}.html`);
        
        await fs.writeFile(markdownPath, markdownContent);
        await fs.writeFile(htmlPath, htmlContent);
        
        console.log(`Saved to ${markdownPath}`);
        
        // Add a small delay between requests to avoid rate limiting
        if (i < questions.length - 1) {
          console.log('Waiting a moment before processing next question...');
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
      
      console.log(`\nAll ${questions.length} question posts generated successfully!`);
      console.log(`Markdown files saved to: ${mdDir}`);
      console.log(`HTML files saved to: ${htmlDir}`);
      
    } catch (error) {
      console.error('Error processing questions:', error);
      throw error;
    }
  }

  /**
   * Lists all available question files
   * @returns {Array} Array of query IDs with available question data
   */
  async listAvailableQuestions() {
    try {
      const questionsDir = path.join('outputs', 'questions');
      const files = await fs.readdir(questionsDir);
      
      // Filter for question files
      const questionFiles = files.filter(file => file.startsWith('questions-') && file.endsWith('.json'));
      
      // Extract query IDs from filenames
      const queryIds = questionFiles.map(file => file.replace('questions-', '').replace('.json', ''));
      
      return queryIds;
    } catch (error) {
      console.error('Error listing available question files:', error);
      return [];
    }
  }
}

/**
 * Main entry point for processing questions
 */
const runQuestions = async (queryId) => {
  const aiProviderType = process.env.AI_PROVIDER || 'gemini';
  const aiProviderKey = aiProviderType === 'gemini' ? 
    process.env.GEMINI_API_KEY : 
    process.env.OPENAI_API_KEY;
  
  if (!aiProviderKey) {
    console.error(`Please set ${aiProviderType.toUpperCase()}_API_KEY in your .env file`);
    process.exit(1);
  }
  
  const questionsGenerator = new QuestionsGenerator(aiProviderType, aiProviderKey);
  
  try {
    if (queryId) {
      // Process specific query
      await questionsGenerator.processQueryQuestions(queryId);
    } else {
      // List available question files and let user choose
      const availableQueries = await questionsGenerator.listAvailableQuestions();
      
      if (availableQueries.length === 0) {
        console.log('No question files available. Please run "npm run bulk <queryId>" first to generate question data.');
        process.exit(0);
      }
      
      console.log('Available question files:');
      for (let i = 0; i < availableQueries.length; i++) {
        console.log(`${i + 1}. ${availableQueries[i]}`);
      }
      
      console.log('\nTo process questions, run: npm run questions <queryId>');
      console.log('Example: npm run questions', availableQueries[0]);
    }
  } catch (error) {
    console.error('Error running questions processor:', error);
    process.exit(1);
  }
};

// Main script entry point
const queryId = process.argv[2];
runQuestions(queryId).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

module.exports = { QuestionsGenerator }; 