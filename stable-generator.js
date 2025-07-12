const fetch = require('node-fetch');
const fs = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');

dotenv.config();

// Default settings for easy access and modification
const DEFAULT_OPTIONS = {
  limit: 1,                // Number of images to generate
  cfgScale: 5,             // How strictly the diffusion process adheres to the prompt
  height: 1024,            // Image height
  width: 1024,             // Image width
  steps: 30,               // Number of diffusion steps to run
  samples: 1,              // Number of images to generate per prompt
  stylePreset: '', // Optional style preset
  engine: 'stable-diffusion-v1-6', // Engine ID
  negativePrompt: 'camera',      // Optional negative prompt
  // Image processing options
  processImages: true,     // Whether to process images with Sharp
  outputFormat: 'webp',    // Output format: 'webp', 'jpeg', 'png'
  outputWidth: 1000,       // Target width in pixels
  webpQuality: 80          // WebP quality (0-100, higher is better quality)
};

class StabilityImageGenerator {
  constructor(stabilityApiKey) {
    this.apiKey = stabilityApiKey;
    this.apiHost = process.env.STABILITY_API_HOST || 'https://api.stability.ai';
  }

  /**
   * Ensures all necessary directories exist
   */
  async ensureDirectories() {
    // Create base directories
    await fs.mkdir('outputs', { recursive: true });
    // Create image library as sibling of outputs
    await fs.mkdir('image-library', { recursive: true });
    // Create stability-specific directory and subdirectories
    await fs.mkdir(path.join('image-library', 'stability'), { recursive: true });
    await fs.mkdir(path.join('image-library', 'stability', 'states'), { recursive: true });
  }

  /**
   * Generate images from text prompt
   * @param {string} prompt - Text prompt
   * @param {Object} options - Generation options
   * @returns {Promise<Array>} - List of generated images
   */
  async generateImages(prompt, options = {}) {
    try {
      const engineId = options.engine || DEFAULT_OPTIONS.engine;
      const cfgScale = options.cfgScale || DEFAULT_OPTIONS.cfgScale;
      const height = options.height || DEFAULT_OPTIONS.height;
      const width = options.width || DEFAULT_OPTIONS.width;
      const steps = options.steps || DEFAULT_OPTIONS.steps;
      const samples = options.samples || DEFAULT_OPTIONS.samples;
      
      // Prepare API request body
      const requestBody = {
        text_prompts: [
          {
            text: prompt,
            weight: 1
          }
        ],
        cfg_scale: cfgScale,
        height: height,
        width: width,
        steps: steps,
        samples: samples
      };
      
      // Add negative prompt if provided
      if (options.negativePrompt) {
        requestBody.text_prompts.push({
          text: options.negativePrompt,
          weight: -1
        });
      }
      
      // Add style preset if provided
      if (options.stylePreset) {
        requestBody.style_preset = options.stylePreset;
      }
      
      console.log(`Generating images with prompt: "${prompt}"`);
      console.log(`Engine: ${engineId}, Dimensions: ${width}x${height}, Steps: ${steps}`);
      
      const response = await fetch(
        `${this.apiHost}/v1/generation/${engineId}/text-to-image`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(requestBody)
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API Error: ${response.status} - ${errorText}`);
        throw new Error(`Stability API error: ${response.status} - ${errorText}`);
      }
      
      const responseData = await response.json();
      
      console.log(`Generated ${responseData.artifacts.length} images successfully`);
      
      return responseData.artifacts;
    } catch (error) {
      console.error('Error generating images:', error.message);
      throw error;
    }
  }

  /**
   * Save and process a base64 image
   * @param {string} base64String - Base64 encoded image
   * @param {string} filename - Destination filename
   * @param {Object} options - Processing options
   * @returns {Promise<string>} The saved filename
   */
  async saveBase64Image(base64String, filename, options = {}) {
    try {
      const buffer = Buffer.from(base64String, 'base64');
      
      // Process the image if enabled
      if (options.processImages) {
        const outputFormat = options.outputFormat || DEFAULT_OPTIONS.outputFormat;
        const outputWidth = options.outputWidth || DEFAULT_OPTIONS.outputWidth;
        const quality = options.webpQuality || DEFAULT_OPTIONS.webpQuality;
        
        // Change the file extension in the filename
        const baseFilename = path.parse(filename).name;
        const newFilename = path.join(path.dirname(filename), `${baseFilename}.${outputFormat}`);
        
        // Process image with Sharp
        console.log(`Processing image to ${outputFormat} format at ${outputWidth}px width...`);
        
        const processedImage = sharp(buffer)
          .resize({ 
            width: outputWidth,
            withoutEnlargement: true // Don't enlarge images smaller than target size
          });
          
        // Set format-specific options
        if (outputFormat === 'webp') {
          processedImage.webp({ quality });
        } else if (outputFormat === 'jpeg') {
          processedImage.jpeg({ quality });
        } else if (outputFormat === 'png') {
          processedImage.png({ quality });
        }
        
        // Save the processed image
        await processedImage.toFile(newFilename);
        console.log(`Processed and saved: ${newFilename}`);
        
        // Return the new filename for metadata tracking
        return newFilename;
      } else {
        // Save the original image without processing
        await fs.writeFile(filename, buffer);
        console.log(`Saved: ${filename}`);
        return filename;
      }
    } catch (error) {
      console.error(`Error saving/processing image:`, error.message);
      throw error;
    }
  }

  /**
   * Generate and save images from a text prompt
   * @param {string} prompt - Text prompt
   * @param {Object} options - Generation options
   */
  async generateAndSaveImages(prompt, options = {}) {
    try {
      await this.ensureDirectories();

      // Create a directory for this prompt
      const dirName = prompt.replace(/,/g, '-').replace(/\s+/g, '_').substring(0, 50).toLowerCase();
      const outputDir = path.join('image-library', 'stability', dirName);
      const jsonDir = path.join(outputDir, 'json');
      
      // Create main directory and json subdirectory
      await fs.mkdir(outputDir, { recursive: true });
      await fs.mkdir(jsonDir, { recursive: true });

      // Generate images
      const artifacts = await this.generateImages(prompt, options);
      
      if (artifacts.length === 0) {
        console.log('No images were generated.');
        return;
      }

      // Limit number of downloads based on options or default
      const downloadLimit = Math.min(options.limit || DEFAULT_OPTIONS.limit, artifacts.length);
      console.log(`Saving ${downloadLimit} images to ${outputDir}`);

      // Save each image
      const savedImages = [];
      for (let i = 0; i < downloadLimit; i++) {
        const image = artifacts[i];
        
        // Create a descriptive filename
        const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').substring(0, 14);
        const originalFilename = `stability_${timestamp}_${image.seed}.png`;
        const outputPath = path.join(outputDir, originalFilename);
        
        // Save and process the image
        const savedFilePath = await this.saveBase64Image(image.base64, outputPath, options);
        const savedFilename = path.basename(savedFilePath);
        
        // Save metadata to the json subdirectory
        const metadata = {
          prompt: prompt,
          seed: image.seed,
          finishReason: image.finishReason,
          cfgScale: options.cfgScale || DEFAULT_OPTIONS.cfgScale,
          height: options.height || DEFAULT_OPTIONS.height,
          width: options.width || DEFAULT_OPTIONS.width,
          steps: options.steps || DEFAULT_OPTIONS.steps,
          engine: options.engine || DEFAULT_OPTIONS.engine,
          stylePreset: options.stylePreset || '',
          negativePrompt: options.negativePrompt || '',
          generated: new Date().toISOString(),
          originalFilename: originalFilename,
          filename: savedFilename,
          processed: options.processImages || DEFAULT_OPTIONS.processImages,
          format: options.outputFormat || DEFAULT_OPTIONS.outputFormat
        };
        
        await fs.writeFile(
          path.join(jsonDir, `${image.seed}_metadata.json`), 
          JSON.stringify(metadata, null, 2)
        );
        
        savedImages.push({
          path: savedFilePath,
          seed: image.seed,
          metadata: metadata
        });
      }

      // Save generation metadata
      await fs.writeFile(
        path.join(jsonDir, 'generation_results.json'),
        JSON.stringify({
          prompt: prompt,
          options: options,
          timestamp: new Date().toISOString(),
          images: savedImages.map(img => ({
            seed: img.metadata.seed,
            filename: img.metadata.filename
          }))
        }, null, 2)
      );
      
      // Save the prompt state for future reference
      await this.savePromptState(prompt, options);
      
      console.log(`\nGeneration complete! Images saved to ${outputDir}`);
      console.log(`Generated ${downloadLimit} images for prompt: "${prompt}"`);
      console.log(`JSON metadata files saved to ${jsonDir}`);
      
    } catch (error) {
      console.error('Error generating and saving images:', error.message);
      throw error;
    }
  }

  /**
   * Save the current prompt state to remember configurations
   * @param {string} prompt - The prompt used
   * @param {Object} options - The options used
   */
  async savePromptState(prompt, options) {
    try {
      const promptKey = prompt.replace(/,/g, '-').replace(/\s+/g, '_').substring(0, 50).toLowerCase();
      const stateDir = path.join('image-library', 'stability', 'states');
      await fs.mkdir(stateDir, { recursive: true });
      
      const stateFile = path.join(stateDir, `${promptKey}_state.json`);
      const stateData = {
        prompt: prompt,
        options: options,
        lastUpdated: new Date().toISOString()
      };
      
      await fs.writeFile(stateFile, JSON.stringify(stateData, null, 2));
      console.log(`Prompt state saved to ${stateFile}`);
      
      // Create a command suggestion with the most important options
      let commandSuggestion = `npm run stability "${prompt}"`;
      if (options.cfgScale && options.cfgScale !== DEFAULT_OPTIONS.cfgScale) {
        commandSuggestion += ` --cfgScale=${options.cfgScale}`;
      }
      if (options.steps && options.steps !== DEFAULT_OPTIONS.steps) {
        commandSuggestion += ` --steps=${options.steps}`;
      }
      if (options.outputFormat && options.outputFormat !== DEFAULT_OPTIONS.outputFormat) {
        commandSuggestion += ` --outputFormat=${options.outputFormat}`;
      }
      console.log(`Next time, use: ${commandSuggestion}`);
    } catch (error) {
      console.error('Error saving prompt state:', error.message);
    }
  }

  /**
   * List all saved prompt states
   */
  async listPromptStates() {
    try {
      const stateDir = path.join('image-library', 'stability', 'states');
      await fs.mkdir(stateDir, { recursive: true });
      
      const files = await fs.readdir(stateDir);
      const stateFiles = files.filter(file => file.endsWith('_state.json'));
      
      if (stateFiles.length === 0) {
        console.log('No saved Stability AI prompt states found.');
        return;
      }
      
      console.log('Previous Stability AI prompts:');
      for (const file of stateFiles) {
        const stateData = JSON.parse(await fs.readFile(path.join(stateDir, file), 'utf8'));
        
        // Create a command suggestion with important options only
        let commandSuggestion = `npm run stability "${stateData.prompt}"`;
        const opts = stateData.options || {};
        
        if (opts.cfgScale && opts.cfgScale !== DEFAULT_OPTIONS.cfgScale) {
          commandSuggestion += ` --cfgScale=${opts.cfgScale}`;
        }
        if (opts.steps && opts.steps !== DEFAULT_OPTIONS.steps) {
          commandSuggestion += ` --steps=${opts.steps}`;
        }
        
        console.log(`- Prompt: "${stateData.prompt}"`);
        console.log(`  Command: ${commandSuggestion}`);
      }
    } catch (error) {
      console.error('Error listing prompt states:', error.message);
    }
  }
}

// Main execution function
const run = async () => {
  try {
    // Get API key from environment variable
    const apiKey = process.env.STABILITY_API_KEY;
    if (!apiKey) {
      console.error('Please set STABILITY_API_KEY in your .env file');
      process.exit(1);
    }

    // Parse command line arguments
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      console.error('Please provide a prompt or "list" to see previous prompts');
      console.error('Usage: npm run stability <prompt> [options]');
      console.error('Example: npm run stability "A lighthouse on a cliff" --cfgScale=7 --steps=30 --outputFormat=webp');
      console.error('To list previous prompts: npm run stability list');
      process.exit(1);
    }

    // Initialize image generator
    const imageGenerator = new StabilityImageGenerator(apiKey);
    
    // Check for "list" command
    if (args[0].toLowerCase() === 'list') {
      await imageGenerator.listPromptStates();
      return;
    }

    // First argument is the prompt
    const prompt = args[0];
    
    // Start with the default options
    const options = { ...DEFAULT_OPTIONS };
    
    // Parse options from remaining arguments
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--')) {
        const [key, value] = arg.slice(2).split('=');
        // Convert numeric values to numbers
        if (!isNaN(value)) {
          options[key] = parseInt(value);
        } else if (value === 'true' || value === 'false') {
          options[key] = value === 'true';
        } else {
          options[key] = value;
        }
      }
    }
    
    console.log('Options:', options);

    // Generate and save images
    await imageGenerator.generateAndSaveImages(prompt, options);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
};

// Run the script
run();

module.exports = { StabilityImageGenerator };
