const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');

dotenv.config();

// Default settings for easy access and modification
const DEFAULT_OPTIONS = {
  limit: 60,             // Number of images to download (max per page)
  imageSize: 'large',    // Size of images: 'original', 'large', 'medium'
  order: 'latest',      // 'popular' or 'latest'
  imageType: 'vector',  // 'photo', 'illustration', 'vector', or 'all'
  orientation: 'horizontal', // 'horizontal', 'vertical', or 'all'
  safeSearch: true,      // Whether to enable safe search
  perPage: 200,          // Number of results per page in API request (max 200)
  page: 1,                // Page number to download from
  // Image processing options
  processImages: true,   // Whether to process images with Sharp
  outputFormat: 'webp',  // Output format: 'webp', 'jpeg', 'png'
  outputWidth: 1000,     // Target width in pixels
  webpQuality: 80        // WebP quality (0-100, higher is better quality)
};

class ImageGenerator {
  constructor(pixabayApiKey) {
    this.apiKey = pixabayApiKey;
    this.baseUrl = 'https://pixabay.com/api/';
  }

  /**
   * Ensures all necessary directories exist
   */
  async ensureDirectories() {
    // Create base directories
    await fs.mkdir('outputs', { recursive: true });
    // Create image library as sibling of outputs
    await fs.mkdir('image-library', { recursive: true });
    // Create pixabay-specific directory and subdirectories
    await fs.mkdir(path.join('image-library', 'pixabay'), { recursive: true });
    await fs.mkdir(path.join('image-library', 'pixabay', 'states'), { recursive: true });
  }

  /**
   * Search for images with given tags
   * @param {string} tags - Search tags (comma separated)
   * @param {Object} options - Additional search options
   * @returns {Promise<Array>} - List of images
   */
  async searchImages(tags, options = {}) {
    try {
      // Convert comma-separated tags to URL-friendly format
      const searchTerm = tags.split(',').map(tag => tag.trim()).join('+');
      
      const page = options.page || DEFAULT_OPTIONS.page;
      const perPage = options.perPage || DEFAULT_OPTIONS.perPage;
      
      // Set up default search parameters
      const params = {
        key: this.apiKey,
        q: searchTerm,
        image_type: options.imageType || DEFAULT_OPTIONS.imageType,
        orientation: options.orientation || DEFAULT_OPTIONS.orientation,
        safesearch: options.safeSearch !== undefined ? options.safeSearch : DEFAULT_OPTIONS.safeSearch,
        per_page: perPage,
        page: page,
        ...options.additionalParams
      };

      // Add optional parameters if provided
      if (options.category) params.category = options.category;
      if (options.minWidth) params.min_width = options.minWidth;
      if (options.minHeight) params.min_height = options.minHeight;
      if (options.colors) params.colors = options.colors;
      if (options.editorsChoice) params.editors_choice = options.editorsChoice;
      if (options.order) params.order = options.order;

      console.log(`Searching for images with tags: ${tags}`);
      console.log(`Fetching page ${page} with ${perPage} images per page (max allowed: 200)`);
      console.log(`Image type filter: ${params.image_type}`);
      
      const response = await axios.get(this.baseUrl, { params });
      
      console.log(`Found ${response.data.totalHits} total matching images`);
      console.log(`Showing results ${(page-1)*perPage + 1} to ${(page-1)*perPage + response.data.hits.length}`);
      
      return response.data.hits;
    } catch (error) {
      console.error('Error searching for images:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Download an image from a URL
   * @param {string} url - Image URL
   * @param {string} filename - Destination filename
   */
  async downloadImage(url, filename, options = {}) {
    try {
      const response = await axios({
        method: 'GET',
        url,
        responseType: 'arraybuffer'
      });

      // Process the image if enabled
      if (options.processImages) {
        const outputFormat = options.outputFormat || DEFAULT_OPTIONS.outputFormat;
        const outputWidth = options.outputWidth || DEFAULT_OPTIONS.outputWidth;
        const quality = options.webpQuality || DEFAULT_OPTIONS.webpQuality;
        
        // Get file extension from the format
        const fileExt = outputFormat;
        
        // Change the file extension in the filename
        const baseFilename = path.parse(filename).name;
        const newFilename = path.join(path.dirname(filename), `${baseFilename}.${fileExt}`);
        
        // Process image with Sharp
        console.log(`Processing image to ${outputFormat} format at ${outputWidth}px width...`);
        
        const processedImage = sharp(response.data)
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
        await fs.writeFile(filename, response.data);
        console.log(`Downloaded: ${filename}`);
        return filename;
      }
    } catch (error) {
      console.error(`Error downloading/processing ${url}:`, error.message);
      throw error;
    }
  }

  /**
   * Download images matching the given tags
   * @param {string} tags - Search tags (comma separated)
   * @param {Object} options - Additional search and download options
   */
  async downloadImagesByTags(tags, options = {}) {
    try {
      await this.ensureDirectories();

      // Create a directory for this tag set
      const dirName = tags.replace(/,/g, '-').replace(/\s+/g, '_');
      const outputDir = path.join('image-library', 'pixabay', dirName);
      const jsonDir = path.join(outputDir, 'json');
      
      // Create main directory and json subdirectory
      await fs.mkdir(outputDir, { recursive: true });
      await fs.mkdir(jsonDir, { recursive: true });

      // Search for images
      const images = await this.searchImages(tags, options);
      
      if (images.length === 0) {
        console.log('No images found matching your search criteria.');
        return;
      }

      // Limit number of downloads based on options or default
      const downloadLimit = Math.min(options.limit || DEFAULT_OPTIONS.limit, images.length);
      console.log(`Downloading ${downloadLimit} images to ${outputDir}`);

      // Download each image
      const imageSize = options.imageSize || DEFAULT_OPTIONS.imageSize;
      for (let i = 0; i < downloadLimit; i++) {
        const image = images[i];
        
        // Determine which URL to use based on requested size
        let imageUrl;
        if (imageSize === 'original' && image.imageURL) {
          imageUrl = image.imageURL;
        } else if (imageSize === 'large' && image.largeImageURL) {
          imageUrl = image.largeImageURL;
        } else if (imageSize === 'medium') {
          imageUrl = image.webformatURL;
        } else {
          imageUrl = image.webformatURL; // Default to medium if requested size not available
        }

        // Create a descriptive filename
        const filename = `${image.id}_${image.user}_${dirName}.jpg`;
        const outputPath = path.join(outputDir, filename);
        
        // Download and process the image
        const actualFilename = await this.downloadImage(imageUrl, outputPath, options);
        
        // Use the actual filename (which may have a different extension after processing)
        const savedFilename = path.basename(actualFilename);
        
        // Save metadata to the json subdirectory
        const metadata = {
          id: image.id,
          tags: image.tags,
          user: image.user,
          pageURL: image.pageURL,
          downloads: image.downloads,
          likes: image.likes,
          imageSize: image.imageSize,
          imageWidth: image.imageWidth,
          imageHeight: image.imageHeight,
          downloaded: new Date().toISOString(),
          filename: savedFilename,
          processed: options.processImages || DEFAULT_OPTIONS.processImages,
          format: options.outputFormat || DEFAULT_OPTIONS.outputFormat
        };
        
        await fs.writeFile(
          path.join(jsonDir, `${image.id}_metadata.json`), 
          JSON.stringify(metadata, null, 2)
        );
      }

      // Save search results metadata to the json subdirectory
      await fs.writeFile(
        path.join(jsonDir, 'search_results.json'),
        JSON.stringify({
          query: tags,
          options: options,
          totalResults: images.length,
          timestamp: new Date().toISOString(),
          images: images.slice(0, downloadLimit).map(img => ({
            id: img.id,
            tags: img.tags,
            user: img.user,
            thumbnail: img.previewURL,
            filename: `${img.id}_${img.user}_${dirName}.jpg`
          }))
        }, null, 2)
      );

      // Save the current search state for future reference
      await this.saveSearchState(
        tags, 
        options.page || DEFAULT_OPTIONS.page,
        options.imageType || DEFAULT_OPTIONS.imageType
      );
      
      console.log(`\nDownload complete! Images saved to ${outputDir}`);
      console.log(`Downloaded ${downloadLimit} images for tags: ${tags} (page ${options.page || DEFAULT_OPTIONS.page})`);
      console.log(`JSON metadata files saved to ${jsonDir}`);
      console.log('Remember to follow Pixabay\'s API terms: Images must be attributed and may not be permanently hotlinked.');
      
    } catch (error) {
      console.error('Error downloading images:', error.message);
      throw error;
    }
  }

  /**
   * Save the current search state to remember where you left off
   * @param {string} tags - The search tags
   * @param {number} page - The current page number
   * @param {string} imageType - The image type filter
   */
  async saveSearchState(tags, page, imageType) {
    try {
      const searchKey = tags.replace(/,/g, '-').replace(/\s+/g, '_').toLowerCase();
      const stateDir = path.join('image-library', 'pixabay', 'states');
      await fs.mkdir(stateDir, { recursive: true });
      
      const stateFile = path.join(stateDir, `${searchKey}_state.json`);
      const stateData = {
        tags: tags,
        lastPage: page,
        imageType: imageType,
        lastUpdated: new Date().toISOString()
      };
      
      await fs.writeFile(stateFile, JSON.stringify(stateData, null, 2));
      console.log(`Search state saved to ${stateFile}`);
      console.log(`Next time, use: npm run pixabay "${tags}" --page=${page+1} --imageType=${imageType}`);
    } catch (error) {
      console.error('Error saving search state:', error.message);
    }
  }

  /**
   * List all saved search states
   */
  async listSearchStates() {
    try {
      const stateDir = path.join('image-library', 'pixabay', 'states');
      await fs.mkdir(stateDir, { recursive: true });
      
      const files = await fs.readdir(stateDir);
      const stateFiles = files.filter(file => file.endsWith('_state.json'));
      
      if (stateFiles.length === 0) {
        console.log('No saved Pixabay search states found.');
        return;
      }
      
      console.log('Previous Pixabay searches:');
      for (const file of stateFiles) {
        const stateData = JSON.parse(await fs.readFile(path.join(stateDir, file), 'utf8'));
        console.log(`- Tags: "${stateData.tags}" (Last page: ${stateData.lastPage}, Type: ${stateData.imageType})`);
        console.log(`  Command: npm run pixabay "${stateData.tags}" --page=${stateData.lastPage+1} --imageType=${stateData.imageType}`);
      }
    } catch (error) {
      console.error('Error listing search states:', error.message);
    }
  }
}

// Main execution function
const run = async () => {
  try {
    // Get API key from environment variable
    const apiKey = process.env.PIXABAY_API_KEY;
    if (!apiKey) {
      console.error('Please set PIXABAY_API_KEY in your .env file');
      process.exit(1);
    }

    // Parse command line arguments
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      console.error('Please provide search tags or "list" to see previous searches');
      console.error('Usage: npm run pixabay <tags> [options]');
      console.error('Example: npm run pixabay "nature,landscape" --page=2 --imageType=photo');
      console.error('To list previous searches: npm run pixabay list');
      process.exit(1);
    }

    // Initialize image generator
    const imageGenerator = new ImageGenerator(apiKey);
    
    // Check for "list" command
    if (args[0].toLowerCase() === 'list') {
      await imageGenerator.listSearchStates();
      return;
    }

    // First argument is the tags
    const tags = args[0];
    
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

    // Download images
    await imageGenerator.downloadImagesByTags(tags, options);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
};

// Run the script
run();

module.exports = { ImageGenerator };
