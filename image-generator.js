const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Default settings for easy access and modification
const DEFAULT_OPTIONS = {
  limit: 10,             // Number of images to download
  imageSize: 'large',    // Size of images: 'original', 'large', 'medium'
  order: 'popular',      // 'popular' or 'latest'
  imageType: 'photo',    // 'photo', 'illustration', 'vector', or 'all'
  orientation: 'horizontal', // 'horizontal', 'vertical', or 'all'
  safeSearch: true,      // Whether to enable safe search
  perPage: 30            // Number of results per page in API request
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
    await fs.mkdir(path.join('outputs', 'images'), { recursive: true });
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
      
      // Set up default search parameters
      const params = {
        key: this.apiKey,
        q: searchTerm,
        image_type: options.imageType || DEFAULT_OPTIONS.imageType,
        orientation: options.orientation || DEFAULT_OPTIONS.orientation,
        safesearch: options.safeSearch !== undefined ? options.safeSearch : DEFAULT_OPTIONS.safeSearch,
        per_page: options.perPage || DEFAULT_OPTIONS.perPage,
        page: options.page || 1,
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
      const response = await axios.get(this.baseUrl, { params });
      
      console.log(`Found ${response.data.totalHits} images (showing ${response.data.hits.length})`);
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
  async downloadImage(url, filename) {
    try {
      const response = await axios({
        method: 'GET',
        url,
        responseType: 'arraybuffer'
      });

      await fs.writeFile(filename, response.data);
      console.log(`Downloaded: ${filename}`);
    } catch (error) {
      console.error(`Error downloading ${url}:`, error.message);
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
      const outputDir = path.join('outputs', 'images', dirName);
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
        
        // Download the image to the main directory
        await this.downloadImage(imageUrl, outputPath);
        
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
          filename: filename
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

      console.log(`\nDownload complete! Images saved to ${outputDir}`);
      console.log(`Downloaded ${downloadLimit} images for tags: ${tags}`);
      console.log(`JSON metadata files saved to ${jsonDir}`);
      console.log('Remember to follow Pixabay\'s API terms: Images must be attributed and may not be permanently hotlinked.');
      
    } catch (error) {
      console.error('Error downloading images:', error.message);
      throw error;
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
      console.error('Please provide search tags');
      console.error('Usage: npm run image <tags> [options]');
      console.error('Example: npm run image "nature,landscape" --limit=10 --size=large');
      process.exit(1);
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

    // Initialize image generator and download images
    const imageGenerator = new ImageGenerator(apiKey);
    await imageGenerator.downloadImagesByTags(tags, options);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
};

// Run the script
run();

module.exports = { ImageGenerator };
