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
            console.log(`Model overloaded, retrying in ${delay / 1000} seconds... (Attempt ${attempt}/${maxRetries})`);
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

      // Create an index of all questions for linking
      const questionIndex = questions.map(q => {
        const { question } = q;
        const safeQuestion = question
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .substring(0, 50);

        return {
          question,
          filename: `${safeQuestion}.md`,
          htmlFilename: `${safeQuestion}.html`
        };
      });

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

        // Add links to related questions at the bottom of the content
        const updatedContent = this.addRelatedQuestionLinks(markdownContent, questionIndex, safeQuestion, keyword);

        // Convert to HTML
        const htmlContent = marked(updatedContent);

        // Save files
        const markdownPath = path.join(mdDir, `${safeQuestion}.md`);
        const htmlPath = path.join(htmlDir, `${safeQuestion}.html`);

        await fs.writeFile(markdownPath, updatedContent);
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
   * Adds related question links to the bottom of a post
   * @param {string} content - The original post content
   * @param {Array} questionIndex - List of all questions
   * @param {string} currentQuestionFile - Filename of the current question
   * @param {string} keyword - The main keyword
   * @returns {string} - Content with related links section
   */
  addRelatedQuestionLinks(content, questionIndex, currentQuestionFile, keyword) {
    // Get up to 5 random questions, excluding the current one
    const otherQuestions = questionIndex
      .filter(q => !q.filename.startsWith(currentQuestionFile))
      .sort(() => 0.5 - Math.random()) // shuffle the array
      .slice(0, 5);

    if (otherQuestions.length === 0) {
      return content;
    }

    // Add a "Related Questions" section at the end with links
    let relatedContent = `\n\n## More Questions About ${keyword}\n\n`;
    otherQuestions.forEach(q => {
      // Create a link with the proper format: /posts/filename (without .md extension)
      const linkPath = `/posts/${path.parse(q.filename).name}`;
      relatedContent += `- [${q.question}](${linkPath})\n`;
    });

    return content + relatedContent;
  }

  /**
   * Generates an index page that links to all question posts
   * @param {string} keyword - The main keyword
   * @param {Array} questionIndex - List of all questions
   * @param {string} mdDir - Directory for markdown files
   * @param {string} htmlDir - Directory for HTML files
   */
  async generateIndexPage(keyword, questionIndex, mdDir, htmlDir) {
    const title = `Common Questions About ${keyword}`;

    // Create markdown index
    let mdContent = `# ${title}\n\n`;
    mdContent += `This page provides answers to common questions about ${keyword}.\n\n`;

    // Group questions by type if available
    const groupedQuestions = questionIndex.reduce((acc, q) => {
      const type = q.type || 'general';
      if (!acc[type]) acc[type] = [];
      acc[type].push(q);
      return acc;
    }, {});

    // Add links to all questions
    Object.keys(groupedQuestions).forEach(type => {
      if (type !== 'general') {
        mdContent += `## ${type.charAt(0).toUpperCase() + type.slice(1)} Questions\n\n`;
      }

      groupedQuestions[type].forEach(q => {
        mdContent += `- [${q.question}](./${q.filename})\n`;
      });

      mdContent += '\n';
    });

    // Convert to HTML
    const htmlContent = marked(mdContent);

    // Save files
    await fs.writeFile(path.join(mdDir, 'index.md'), mdContent);
    await fs.writeFile(path.join(htmlDir, 'index.html'), htmlContent);
  }

  /**
   * Lists all available question files
   * @returns {Array} Array of objects with queryId and keyword data
   */
  async listAvailableQuestions() {
    try {
      const questionsDir = path.join('outputs', 'questions');
      const files = await fs.readdir(questionsDir);

      // Filter for question files
      const questionFiles = files.filter(file => file.startsWith('questions-') && file.endsWith('.json'));

      // Extract query IDs from filenames and load keyword data
      const queryInfoList = [];

      for (const file of questionFiles) {
        const queryId = file.replace('questions-', '').replace('.json', '');
        try {
          // Load the JSON file to get the keyword
          const filePath = path.join(questionsDir, file);
          const fileContent = await fs.readFile(filePath, 'utf8');
          const data = JSON.parse(fileContent);

          queryInfoList.push({
            queryId,
            keyword: data.keyword || 'Unknown keyword'
          });
        } catch (err) {
          // If can't read the file or parse JSON, still include the ID but with unknown keyword
          queryInfoList.push({
            queryId,
            keyword: 'Unable to read keyword'
          });
        }
      }

      return queryInfoList;
    } catch (error) {
      console.error('Error listing available question files:', error);
      return [];
    }
  }

  /**
   * Lists questions for a specific query ID in plain text format
   * @param {string} queryId - The NeuronWriter query ID
   */
  async listQuestionsForQuery(queryId) {
    try {
      // Load questions data
      const questionsData = await this.loadQuestionsData(queryId);
      const { keyword, questions } = questionsData;

      console.log(`\nQuestions for keyword: "${keyword}"`);
      console.log(`Query ID: ${queryId}`);
      console.log(`Total questions: ${questions.length}`);
      console.log('\n--- Questions ---\n');

      // Output each question in plain text format
      questions.forEach((q, index) => {
        // Strip punctuation but keep spaces and letters/numbers
        const cleanQuestion = q.question.replace(/[^\w\s]/g, '').trim();
        console.log(`${cleanQuestion}`);
      });

      console.log('\n--- End of Questions ---\n');

    } catch (error) {
      console.error('Error listing questions:', error);
      throw error;
    }
  }
}

/**
 * Main entry point for processing questions
 */
const scriptType = process.argv[2];
const queryId = process.argv[3];

const runQuestions = async () => {
  // Check if we're running in list mode
  if (scriptType === '--list') {
    if (!queryId) {
      console.error('Please provide a query ID');
      console.error('Usage: npm run question-list <queryId>');
      process.exit(1);
    }

    const questionsGenerator = new QuestionsGenerator('gemini', 'dummy'); // No AI needed for listing
    await questionsGenerator.listQuestionsForQuery(queryId);
    return;
  }

  // Existing logic for processing questions
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
    if (scriptType) {
      // Process specific query (scriptType is actually the queryId in this case)
      await questionsGenerator.processQueryQuestions(scriptType);
    } else {
      // List available question files and let user choose
      const availableQueriesInfo = await questionsGenerator.listAvailableQuestions();

      if (availableQueriesInfo.length === 0) {
        console.log('No question files available. Please run "npm run bulk <queryId>" first to generate question data.');
        process.exit(0);
      }

      console.log('Available question files:');
      for (let i = 0; i < availableQueriesInfo.length; i++) {
        const { queryId, keyword } = availableQueriesInfo[i];
        console.log(`${i + 1}. ${queryId}  -  "${keyword}"`);
      }

      console.log('\nTo process questions, run: npm run questions <queryId>');
      console.log('To list questions, run: npm run question-list <queryId>');
      console.log('Example: npm run questions', availableQueriesInfo[0].queryId);
    }
  } catch (error) {
    console.error('Error running questions processor:', error);
    process.exit(1);
  }
};

runQuestions().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

module.exports = { QuestionsGenerator }; 