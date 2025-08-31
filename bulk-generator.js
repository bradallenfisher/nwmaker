const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');
const { marked } = require('marked');
const { GoogleGenAI } = require('@google/genai');
const AIProviderFactory = require('./providers/AIProviderFactory');

dotenv.config();

/**
 * BulkGenerator class handles the generation of content prompts using NeuronWriter data and Gemini API
 * It generates both single article prompts with outlines and bulk article prompts for content clusters
 */
class BulkGenerator {
  constructor(nwApiKey, aiProviderType, aiProviderKey) {
    this.apiKey = nwApiKey;
    this.aiProvider = AIProviderFactory.createProvider(aiProviderType, aiProviderKey);
    this.baseUrl = 'https://app.neuronwriter.com/neuron-api/0.5/writer';
  }

  /**
   * Fetches keyword analysis data from NeuronWriter API
   * @param {string} queryId - The NeuronWriter query ID
   * @returns {Object} The analyzed data including terms, entities, and competitors
   */
  async getNWData(queryId) {
    const response = await axios.post(
      `${this.baseUrl}/get-query`,
      { query: queryId },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': this.apiKey
        }
      }
    );

    // Add this debugging line to check if ideas and question data exists
    console.log('NeuronWriter data structure:', JSON.stringify({
      hasIdeas: !!response.data.ideas,
      ideas: response.data.ideas ? {
        hasSuggestQuestions: !!response.data.ideas.suggest_questions,
        hasPAA: !!response.data.ideas.people_also_ask,
        hasContentQuestions: !!response.data.ideas.content_questions
      } : null
    }, null, 2));

    return response.data;
  }

  /**
   * Generates an outline using AI provider based on NeuronWriter data
   * Combines title, H1, and H2 terms for comprehensive heading suggestions
   * @param {Object} data - The NeuronWriter analysis data
   * @returns {string} The generated outline text
   */
  async generateOutlineWithAI(data) {
    // Combine title, h1, and h2 terms from terms data
    const titleTermsList = [
      ...data.terms.title.map(t => t.t),
      ...data.terms.h1.map(t => t.t),
      ...data.terms.h2.map(t => t.t)
    ].join('\n');

    const basicTermsList = data.terms.content_basic.map(t => t.t).join(', ');

    // Format entities with their metrics
    const entitiesList = data.terms.entities
      .map(e => `${e.t} (importance: ${e.importance.toFixed(2)}, relevance: ${e.relevance.toFixed(2)}, confidence: ${e.confidence.toFixed(2)})`)
      .join('\n');

    // Read template and replace variables
    let outlinePrompt = await fs.readFile(path.join('inputs', 'prompt-outline.txt'), 'utf8');
    outlinePrompt = outlinePrompt
      .replace('{keyword}', data.keyword)
      .replace('{titleTermsList}', titleTermsList)
      .replace('{basicTermsList}', basicTermsList)
      .replace('{entitiesList}', entitiesList);

    const maxRetries = 3;
    const baseDelay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.aiProvider.generateContent(outlinePrompt);
      } catch (error) {
        if (error.message?.includes("overloaded") && attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          console.log(`Model overloaded, retrying in ${delay / 1000} seconds... (Attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        console.error('Error generating outline:', error);
        throw error;
      }
    }
  }

  /**
   * Creates necessary directory structure for inputs and outputs
   */
  async ensureDirectories() {
    await fs.mkdir('inputs', { recursive: true });
    await fs.mkdir('outputs', { recursive: true });
  }

  /**
   * Formats the prompt data for a single article
   * Includes keyword data, competitor URLs (limited to 10), outline, and term lists
   * @param {Object} data - The NeuronWriter analysis data
   * @param {string} outline - The generated outline
   * @returns {string} The formatted prompt text
   */
  async formatPromptData(data, outline) {
    try {
      // Read from inputs directory
      const topContent = await fs.readFile(path.join('inputs', 'prompt-top.txt'), 'utf8');
      let prompt = topContent + '\n\n';

      // Add main keyword from NeuronWriter data
      prompt += `{main_keyword}="\n${data.keyword}\n"\n\n`;

      // Add competitor URLs from NeuronWriter data (limit to first 10)
      const competitorUrls = data.competitors.slice(0, 10).map(c => c.url);
      prompt += `{competitor_urls}="\n${competitorUrls.join('\n')}\n"\n\n`;

      // Add outline
      prompt += `{outline}="\n${outline}\n"\n\n`;

      // Add keywords section using terms data
      prompt += `{listofkeywords}="\n`;
      prompt += `TITLE TERMS: ==========\n${data.terms.title.map(t => t.t).join('\n')}\n\n`;
      prompt += `DESCRIPTION TERMS: ==========\n${data.terms.desc.map(t => t.t).join('\n')}\n\n`;
      prompt += `H1 HEADERS TERMS: ==========\n${data.terms.h1.map(t => t.t).join('\n')}\n\n`;
      prompt += `H2 HEADERS TERMS: ==========\n${data.terms.h2.map(t => t.t).join('\n')}\n\n`;
      prompt += `BASIC TEXT TERMS: ==========\n${data.terms.content_basic.map(t => t.t).join('\n')}\n\n`;
      prompt += `EXTENDED TEXT TERMS: ==========\n${data.terms.content_extended.map(t => t.t).join('\n')}\n"\n\n`;

      // Add questions section - make sure this part is correctly implemented
      prompt += `{questions}="\n`;

      // Add suggested questions if they exist
      if (data.ideas && data.ideas.suggest_questions && data.ideas.suggest_questions.length > 0) {
        prompt += `SUGGEST QUESTIONS: ==========\n`;
        data.ideas.suggest_questions.forEach(item => {
          prompt += `${item.q}\n`;
        });
        prompt += `\n`;
      }

      // Add people also ask questions if they exist
      if (data.ideas && data.ideas.people_also_ask && data.ideas.people_also_ask.length > 0) {
        prompt += `PAA QUESTIONS: ==========\n`;
        data.ideas.people_also_ask.forEach(item => {
          prompt += `${item.q}\n`;
        });
        prompt += `\n`;
      }

      // Add content questions if they exist
      if (data.ideas && data.ideas.content_questions && data.ideas.content_questions.length > 0) {
        prompt += `CONTENT QUESTIONS: ==========\n`;
        data.ideas.content_questions.forEach(item => {
          prompt += `${item.q}\n`;
        });
        prompt += `\n`;
      }

      // Close the questions section
      prompt += `"\n\n`;

      // Read and append the commands from inputs directory
      const commands = await fs.readFile(path.join('inputs', 'prompt-commands.txt'), 'utf8');
      prompt += commands;

      // Add this inside the formatPromptData method, right after the NeuronWriter data check
      console.log('Questions data structure check:');
      console.log(`Suggest Questions: ${data.ideas?.suggest_questions?.length || 0}`);
      console.log(`People Also Ask: ${data.ideas?.people_also_ask?.length || 0}`);
      console.log(`Content Questions: ${data.ideas?.content_questions?.length || 0}`);

      // Sample of first question from each category (if available)
      if (data.ideas?.suggest_questions?.length > 0) {
        console.log(`Sample suggest question: ${data.ideas.suggest_questions[0].q}`);
      }
      if (data.ideas?.people_also_ask?.length > 0) {
        console.log(`Sample PAA question: ${data.ideas.people_also_ask[0].q}`);
      }
      if (data.ideas?.content_questions?.length > 0) {
        console.log(`Sample content question: ${data.ideas.content_questions[0].q}`);
      }

      return prompt;
    } catch (error) {
      console.error('Error formatting prompt data:', error);
      throw error;
    }
  }

  /**
   * Generates bulk article prompts using AI provider
   * Uses NeuronWriter data to create a topical map and article suggestions
   * @param {Object} data - The NeuronWriter analysis data
   * @returns {string} The generated bulk articles prompt
   */
  async generateBulkArticles(data) {
    // Prepare the common data
    const titleTermsList = [
      ...data.terms.title.map(t => t.t),
      ...data.terms.h1.map(t => t.t),
      ...data.terms.h2.map(t => t.t)
    ].join('\n');

    const basicTermsList = data.terms.content_basic.map(t => t.t).join(', ');
    const entitiesList = data.terms.entities
      .map(e => `${e.t} (importance: ${e.importance.toFixed(2)}, relevance: ${e.relevance.toFixed(2)}, confidence: ${e.confidence.toFixed(2)})`)
      .join('\n');

    // Format questions for the bulk titles prompt
    let questionsText = '';

    // Add suggested questions if they exist
    if (data.ideas && data.ideas.suggest_questions && data.ideas.suggest_questions.length > 0) {
      questionsText += `SUGGEST QUESTIONS:\n`;
      data.ideas.suggest_questions.forEach(item => {
        questionsText += `${item.q}\n`;
      });
      questionsText += `\n`;
    }

    // Add people also ask questions if they exist
    if (data.ideas && data.ideas.people_also_ask && data.ideas.people_also_ask.length > 0) {
      questionsText += `PEOPLE ALSO ASK QUESTIONS:\n`;
      data.ideas.people_also_ask.forEach(item => {
        questionsText += `${item.q}\n`;
      });
      questionsText += `\n`;
    }

    // Add content questions if they exist
    if (data.ideas && data.ideas.content_questions && data.ideas.content_questions.length > 0) {
      questionsText += `CONTENT QUESTIONS:\n`;
      data.ideas.content_questions.forEach(item => {
        questionsText += `${item.q}\n`;
      });
      questionsText += `\n`;
    }

    try {
      // Create directory structure
      const safeFilename = data.keyword
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      // Create keyword directory first, then md and html subdirectories
      const keywordDir = path.join('outputs', 'bulk', safeFilename);
      const mdDir = path.join(keywordDir, 'md');
      const htmlDir = path.join(keywordDir, 'html');

      await fs.mkdir(keywordDir, { recursive: true });
      await fs.mkdir(mdDir, { recursive: true });
      await fs.mkdir(htmlDir, { recursive: true });

      // Step 1: Generate titles
      console.log('Generating article titles...');
      let titlePrompt = await fs.readFile(path.join('inputs', 'prompt-bulk-titles.txt'), 'utf8');
      titlePrompt = titlePrompt
        .replace('{keyword}', data.keyword)
        .replace('{titleTermsList}', titleTermsList)
        .replace('{basicTermsList}', basicTermsList)
        .replace('{entitiesList}', entitiesList)
        .replace('{questions}', questionsText);

      const titlesResponse = await this.aiProvider.generateContent(titlePrompt);
      const titles = titlesResponse.split('\n').filter(line => line.trim());

      // Save titles for reference in the keyword directory with metadata
      const titlesData = {
        keyword: data.keyword,
        titles: titles,
        metadata: {
          generatedAt: new Date().toISOString()
        }
      };
      await fs.writeFile(
        path.join(keywordDir, 'titles.json'),
        JSON.stringify(titlesData, null, 2)
      );

      // Step 2: Generate an article for each title
      console.log('Generating articles for each title...');
      let articlePromptTemplate = await fs.readFile(path.join('inputs', 'prompt-bulk.txt'), 'utf8');

      for (let i = 0; i < titles.length; i++) {
        const title = titles[i];
        console.log(`Generating article ${i + 1} of ${titles.length}: ${title}`);

        const safeTitle = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

        let articlePrompt = articlePromptTemplate
          .replace('{title}', title)
          .replace('{keyword}', data.keyword)
          .replace('{titleTermsList}', titleTermsList)
          .replace('{basicTermsList}', basicTermsList)
          .replace('{entitiesList}', entitiesList)
          .replace('{questions}', questionsText);

        // Save the prompt in JSON format
        const promptData = {
          prompt: articlePrompt,
          metadata: {
            keyword: data.keyword,
            title: title,
            generatedAt: new Date().toISOString()
          }
        };
        await fs.writeFile(
          path.join(keywordDir, `${safeTitle}-prompt.json`),
          JSON.stringify(promptData, null, 2)
        );

        const articleResponse = await this.aiProvider.generateContent(articlePrompt);
        const markdownContent = articleResponse;

        // Add error checking for the response
        if (!markdownContent) {
          console.error('Unexpected response format from AI provider');
          throw new Error('Invalid response format from AI provider');
        }

        // Save markdown and HTML versions in their respective directories
        const htmlContent = marked(markdownContent);

        const markdownPath = path.join(mdDir, `${safeTitle}.md`);
        const htmlPath = path.join(htmlDir, `${safeTitle}.html`);

        await fs.writeFile(markdownPath, markdownContent);
        await fs.writeFile(htmlPath, htmlContent);

        // Add a small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`Generated ${titles.length} articles in:`);
      console.log(`- Keyword directory: ${keywordDir}`);
      console.log(`  ├─ Markdown files: ${mdDir}`);
      console.log(`  └─ HTML files: ${htmlDir}`);

    } catch (error) {
      console.error('Error generating bulk articles:', error);
      throw error;
    }
  }

  /**
   * Main execution method that coordinates the prompt generation process
   * Generates both single article prompt and bulk article prompts
   * @param {string} queryId - The NeuronWriter query ID
   */
  async run(queryId) {
    try {
      // Ensure directories exist
      await this.ensureDirectories();

      console.log('Fetching NeuronWriter data...');
      const nwData = await this.getNWData(queryId);

      // Sanitize the keyword for a safe filename
      const safeFilename = nwData.keyword
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      console.log('Generating outline with AI...');
      const outline = await this.generateOutlineWithAI(nwData);

      console.log('Creating prompt file...');
      const prompt = await this.formatPromptData(nwData, outline);

      // Create metadata object
      const outputData = {
        prompt,
        metadata: {
          queryId,
          keyword: nwData.keyword
        }
      };

      // Save to outputs directory with metadata using .json extension
      const outputPath = path.join('outputs', `${safeFilename}-prompt.json`);
      await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));
      console.log(`Full prompt saved to ${outputPath}`);

      // Save questions data to a separate JSON file in the questions directory
      if (nwData.ideas) {
        // Create questions directory if it doesn't exist
        const questionsDir = path.join('outputs', 'questions');
        await fs.mkdir(questionsDir, { recursive: true });

        // Combine all questions into a single array with their source
        const allQuestions = [];

        if (nwData.ideas.suggest_questions && nwData.ideas.suggest_questions.length > 0) {
          nwData.ideas.suggest_questions.forEach(item => {
            allQuestions.push({
              question: item.q,
              type: 'suggest',
              keyword: nwData.keyword
            });
          });
        }

        if (nwData.ideas.people_also_ask && nwData.ideas.people_also_ask.length > 0) {
          nwData.ideas.people_also_ask.forEach(item => {
            allQuestions.push({
              question: item.q,
              type: 'paa',
              keyword: nwData.keyword
            });
          });
        }

        if (nwData.ideas.content_questions && nwData.ideas.content_questions.length > 0) {
          nwData.ideas.content_questions.forEach(item => {
            allQuestions.push({
              question: item.q,
              type: 'content',
              keyword: nwData.keyword
            });
          });
        }

        // Save questions data with query ID and metadata
        const questionsData = {
          queryId,
          keyword: nwData.keyword,
          questions: allQuestions,
          metadata: {
            generatedAt: new Date().toISOString()
          }
        };

        const questionsPath = path.join(questionsDir, `questions-${queryId}.json`);
        await fs.writeFile(questionsPath, JSON.stringify(questionsData, null, 2));
        console.log(`Questions data saved to ${questionsPath}`);
      }

      // Print the formatted prompt to the console for quick review
      console.log('\n========== FORMATTED PROMPT ==========\n');
      console.log(prompt);
      console.log('\n======================================\n');

      //console.log('Generating bulk articles prompt...');
      //await this.generateBulkArticles(nwData);

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
    }
  }

  /**
 * Fetches all queries for a project from NeuronWriter API
 * @param {string} projectId - The project ID
 * @param {string[]} tags - Optional array of tags to filter queries
 * @returns {Array} An array of query objects
 */
  async getProjectQueries(projectId, tags = []) {
    try {
      // Always fetch all queries (API tag filtering is unreliable)
      console.log(`Fetching all queries for project ${projectId}...`);
      const payload = {
        project: projectId
      };

      const response = await axios.post(
        `${this.baseUrl}/list-queries`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': this.apiKey
          }
        }
      );

      const allQueries = response.data;
      console.log(`Retrieved ${allQueries.length} total queries from project.`);

      // If tags are specified, filter client-side
      if (tags.length > 0) {
        console.log(`Filtering queries by tags: ${tags.join(', ')}`);

        const filteredQueries = allQueries.filter(query => {
          // Check if the query has any of the specified tags
          if (!query.tags || !Array.isArray(query.tags)) {
            return false;
          }
          return tags.some(tag => query.tags.includes(tag));
        });

        console.log(`Found ${filteredQueries.length} queries matching the specified tags.`);

        if (filteredQueries.length === 0) {
          console.log('No queries found with the specified tags. Available tags in project:');
          const allTags = new Set();
          allQueries.forEach(query => {
            if (query.tags && Array.isArray(query.tags)) {
              query.tags.forEach(tag => allTags.add(tag));
            }
          });
          console.log(`Available tags: ${Array.from(allTags).join(', ') || 'None'}`);
        }

        return filteredQueries;
      } else {
        // No tags specified, return all queries
        console.log('No tag filtering requested, returning all queries.');
        return allQueries;
      }
    } catch (error) {
      console.error('Error fetching queries:', error.response?.data || error.message);
      throw error;
    }
  }
}

/// Single query entry point
const runSingleQuery = async (queryId) => {
  if (!queryId) {
    console.error('Please provide a query ID');
    console.error('Usage: npm run bulk <queryId>');
    process.exit(1);
  }

  const nwApiKey = process.env.NEURONWRITER_API_KEY;
  const aiProviderType = process.env.AI_PROVIDER || 'gemini';
  const aiProviderKey = aiProviderType === 'gemini' ?
    process.env.GEMINI_API_KEY :
    process.env.OPENAI_API_KEY;

  if (!nwApiKey || !aiProviderKey) {
    console.error(`Please set both NEURONWRITER_API_KEY and ${aiProviderType.toUpperCase()}_API_KEY in your .env file`);
    process.exit(1);
  }

  const bulkGenerator = new BulkGenerator(nwApiKey, aiProviderType, aiProviderKey);

  try {
    console.log(`Processing single query: ${queryId}`);
    await bulkGenerator.run(queryId);
    console.log('\nQuery processed successfully!');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

/// Project entry point
const runProject = async (projectId, tags = []) => {
  if (!projectId) {
    console.error('Please provide a project ID');
    console.error('Usage: npm run bulk-project <projectId> [tags]');
    process.exit(1);
  }

  const nwApiKey = process.env.NEURONWRITER_API_KEY;
  const aiProviderType = process.env.AI_PROVIDER || 'gemini';
  const aiProviderKey = aiProviderType === 'gemini' ?
    process.env.GEMINI_API_KEY :
    process.env.OPENAI_API_KEY;

  if (!nwApiKey || !aiProviderKey) {
    console.error(`Please set both NEURONWRITER_API_KEY and ${aiProviderType.toUpperCase()}_API_KEY in your .env file`);
    process.exit(1);
  }

  const bulkGenerator = new BulkGenerator(nwApiKey, aiProviderType, aiProviderKey);

  try {
    console.log(`Fetching queries for project ${projectId}${tags.length ? ` with tags: ${tags.join(', ')}` : ''}...`);
    const queries = await bulkGenerator.getProjectQueries(projectId, tags);

    if (!queries || queries.length === 0) {
      console.log('No queries found matching the criteria.');
      return;
    }

    console.log(`Found ${queries.length} queries to process.`);

    for (const query of queries) {
      console.log(`\nProcessing query for keyword: ${query.keyword}`);
      await bulkGenerator.run(query.query);
    }

    console.log('\nAll queries processed successfully!');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

// Main script entry point
const scriptType = process.argv[2];
const id = process.argv[3];
const tags = process.argv.slice(4); // Get any additional arguments as tags

if (scriptType === '--project') {
  runProject(id, tags).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} else {
  runSingleQuery(scriptType).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}