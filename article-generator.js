const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');
const { marked } = require('marked');
const AIProviderFactory = require('./providers/AIProviderFactory');

dotenv.config();

class ArticleGenerator {
  constructor(aiProviderType, aiProviderKey, nwApiKey) {
    this.aiProvider = AIProviderFactory.createProvider(aiProviderType, aiProviderKey);
    this.nwApiKey = nwApiKey;
    this.baseUrl = 'https://app.neuronwriter.com/neuron-api/0.5/writer';
  }

  async generateArticle(promptText) {
    try {
      return await this.aiProvider.generateContent(promptText);
    } catch (error) {
      console.error('Error generating article:', error);
      throw error;
    }
  }

  async importToNeuronWriter(queryId, html, title = null) {
    try {
      console.log(`Importing content to NeuronWriter for query: ${queryId}`);
      const payload = {
        query: queryId,
        html
      };

      if (title) {
        payload.title = title;
      }

      const response = await axios.post(
        `${this.baseUrl}/import-content`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': this.nwApiKey
          }
        }
      );

      console.log('Content imported successfully!');
      return response.data;
    } catch (error) {
      console.error(`Error importing content to NeuronWriter for query ${queryId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  async ensureDirectories() {
    // Create both md and html directories
    await fs.mkdir(path.join('outputs', 'md'), { recursive: true });
    await fs.mkdir(path.join('outputs', 'html'), { recursive: true });
  }

  async run() {
    try {
      await this.ensureDirectories();

      const files = await fs.readdir('outputs');
      const promptFiles = files.filter(file => 
        (file.endsWith('-prompt.json') || file.endsWith('-prompt.txt')) && !file.startsWith('.')
      );

      console.log(`Found ${promptFiles.length} prompt files to process.`);

      for (const promptFile of promptFiles) {
        try {
          console.log(`\nProcessing: ${promptFile}`);
          
          // Read the prompt file
          const promptPath = path.join('outputs', promptFile);
          const fileContent = await fs.readFile(promptPath, 'utf8');
          
          let promptData;
          try {
            promptData = JSON.parse(fileContent);
          } catch (e) {
            console.log('File is in old format or not JSON, treating as plain prompt');
            promptData = { prompt: fileContent };
          }

          // Generate article
          console.log('Generating article...');
          const markdownContent = await this.generateArticle(promptData.prompt);

          // Convert markdown to HTML
          const htmlContent = marked(markdownContent);

          // Create output filenames - handle both .json and .txt extensions
          const baseName = promptFile.replace('-prompt.json', '').replace('-prompt.txt', '');
          const mdOutputPath = path.join('outputs', 'md', `${baseName}.md`);
          const htmlOutputPath = path.join('outputs', 'html', `${baseName}.html`);

          // Save both markdown and HTML versions
          console.log(`Saving markdown to: ${mdOutputPath}`);
          await fs.writeFile(mdOutputPath, markdownContent);

          console.log(`Saving HTML to: ${htmlOutputPath}`);
          await fs.writeFile(htmlOutputPath, htmlContent);

          // Import to NeuronWriter if we have queryId
          if (promptData.metadata?.queryId) {
            await this.importToNeuronWriter(
              promptData.metadata.queryId,
              htmlContent,
              // Extract title from markdown content (first h1)
              markdownContent.match(/^# (.*?)$/m)?.[1]
            );
          }

          // Add a small delay between requests
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
          console.error(`Error processing ${promptFile}:`, error.message);
          continue;
        }
      }

      console.log('\nAll articles generated successfully!');
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
    }
  }
}

// Run the script
const run = async () => {
  const aiProviderType = process.env.AI_PROVIDER || 'gemini';
  const aiProviderKey = aiProviderType === 'gemini' ? 
    process.env.GEMINI_API_KEY : 
    process.env.OPENAI_API_KEY;
  const nwApiKey = process.env.NEURONWRITER_API_KEY;

  if (!aiProviderKey || !nwApiKey) {
    console.error(`Please set ${aiProviderType.toUpperCase()}_API_KEY and NEURONWRITER_API_KEY in your .env file`);
    process.exit(1);
  }

  const articleGenerator = new ArticleGenerator(aiProviderType, aiProviderKey, nwApiKey);
  await articleGenerator.run();
};

run().catch(console.error); 