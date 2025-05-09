const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Default settings for easy access and modification
const DEFAULT_OPTIONS = {
  limit: 80,             // Number of images to download
  imageSize: 'large',    // Size of images: 'original', 'large', 'medium', 'small'
  orientation: 'landscape', // 'landscape', 'portrait', or 'square'
  perPage: 80,           // Number of results per page in API request (max 80)
  color: '',             // Optional color filter (e.g., 'red', 'blue', etc.)
  locale: 'en-US',       // Locale for the search results
  page: 1,               // Page number to fetch
  size: 'large'          // 'small', 'medium', 'large' or specific dimensions like '400x400'
};

class PexelsImageGenerator {
  constructor(pexelsApiKey) {
    this.apiKey = pexelsApiKey;
    this.baseUrl = 'https://api.pexels.com/v1';
  }

  /**
   * Ensures all necessary directories exist
   */
  async ensureDirectories() {
    // Create base directories
    await fs.mkdir('outputs', { recursive: true });
    await fs.mkdir(path.join('outputs', 'images'), { recursive: true });
    // Create pexels-specific directory and subdirectories
    await fs.mkdir(path.join('outputs', 'images', 'pexels'), { recursive: true });
    await fs.mkdir(path.join('outputs', 'images', 'pexels', 'states'), { recursive: true });
  }

  /**
   * Search for images with given query
   * @param {string} query - Search query (comma separated terms)
   * @param {Object} options - Additional search options
   * @returns {Promise<Array>} - List of images
   */
  async searchImages(query, options = {}) {
    try {
      const page = options.page || DEFAULT_OPTIONS.page;
      const perPage = options.perPage || DEFAULT_OPTIONS.perPage;
      
      // Set up default search parameters
      const params = {
        query: query,
        per_page: perPage,
        page: page,
      };

      // Add optional parameters if provided
      if (options.orientation) params.orientation = options.orientation;
      if (options.size) params.size = options.size;
      if (options.color) params.color = options.color;
      if (options.locale) params.locale = options.locale;

      console.log(`Searching for images with query: "${query}"`);
      console.log(`Fetching page ${page} with ${perPage} images per page (max allowed: 80)`);
      
      const response = await axios.get(`${this.baseUrl}/search`, {
        params,
        headers: {
          'Authorization': this.apiKey
        }
      });
      
      console.log(`Found ${response.data.total_results} total matching images`);
      console.log(`Showing results ${(page-1)*perPage + 1} to ${(page-1)*perPage + response.data.photos.length}`);
      
      return response.data.photos;
    } catch (error) {
      console.error('Error searching for images:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get image from a curated collection
   * @param {Object} options - Options for the request
   * @returns {Promise<Array>} - List of curated images
   */
  async getCuratedImages(options = {}) {
    try {
      const page = options.page || DEFAULT_OPTIONS.page;
      const perPage = options.perPage || DEFAULT_OPTIONS.perPage;
      
      const params = {
        per_page: perPage,
        page: page
      };

      console.log('Getting curated images...');
      console.log(`Fetching page ${page} with ${perPage} images per page (max allowed: 80)`);
      
      const response = await axios.get(`${this.baseUrl}/curated`, {
        params,
        headers: {
          'Authorization': this.apiKey
        }
      });
      
      console.log(`Found ${response.data.photos.length} curated images on page ${page}`);
      
      return response.data.photos;
    } catch (error) {
      console.error('Error fetching curated images:', error.response?.data || error.message);
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
   * Get appropriate image URL based on selected size
   * @param {Object} photo - Pexels photo object
   * @param {string} size - Desired size ('original', 'large', 'medium', 'small')
   * @returns {string} - URL for the requested size
   */
  getImageUrlBySize(photo, size) {
    switch (size) {
      case 'original':
        return photo.src.original;
      case 'large':
        return photo.src.large;
      case 'medium':
        return photo.src.medium;
      case 'small':
        return photo.src.small;
      default:
        return photo.src.large; // Default to large if size not recognized
    }
  }

  /**
   * Download images matching the given query
   * @param {string} query - Search query
   * @param {Object} options - Additional search and download options
   * @param {boolean} useCurated - Whether to use curated images instead of search
   */
  async downloadImagesByQuery(query, options = {}, useCurated = false) {
    try {
      await this.ensureDirectories();

      // Create a directory for this query
      const dirName = query.replace(/,/g, '-').replace(/\s+/g, '_').toLowerCase();
      const outputDir = path.join('outputs', 'images', 'pexels', dirName);
      const jsonDir = path.join(outputDir, 'json');
      
      // Create main directory and json subdirectory
      await fs.mkdir(outputDir, { recursive: true });
      await fs.mkdir(jsonDir, { recursive: true });

      // Get images either from search or curated collection
      let photos;
      if (useCurated) {
        photos = await this.getCuratedImages(options);
      } else {
        photos = await this.searchImages(query, options);
      }
      
      if (photos.length === 0) {
        console.log('No images found matching your criteria.');
        return;
      }

      // Limit number of downloads based on options or default
      const downloadLimit = Math.min(options.limit || DEFAULT_OPTIONS.limit, photos.length);
      console.log(`Downloading ${downloadLimit} images to ${outputDir}`);

      // Download each image
      const imageSize = options.imageSize || DEFAULT_OPTIONS.imageSize;
      for (let i = 0; i < downloadLimit; i++) {
        const photo = photos[i];
        
        // Get the appropriate URL for the selected size
        const imageUrl = this.getImageUrlBySize(photo, imageSize);

        // Create a descriptive filename (Pexels ID + photographer + query)
        const safePhotographerName = photo.photographer.replace(/\s+/g, '_').toLowerCase();
        const filename = `${photo.id}_${safePhotographerName}_${dirName}.jpg`;
        const outputPath = path.join(outputDir, filename);
        
        // Download the image to the main directory
        await this.downloadImage(imageUrl, outputPath);
        
        // Save metadata to the json subdirectory
        const metadata = {
          id: photo.id,
          width: photo.width,
          height: photo.height,
          url: photo.url,
          photographer: photo.photographer,
          photographer_url: photo.photographer_url,
          photographer_id: photo.photographer_id,
          avg_color: photo.avg_color,
          src: photo.src, // URLs for all available sizes
          alt: photo.alt,
          downloaded: new Date().toISOString(),
          filename: filename
        };
        
        await fs.writeFile(
          path.join(jsonDir, `${photo.id}_metadata.json`), 
          JSON.stringify(metadata, null, 2)
        );
      }

      // Save search results metadata to the json subdirectory
      await fs.writeFile(
        path.join(jsonDir, 'search_results.json'),
        JSON.stringify({
          query: query,
          options: options,
          useCurated: useCurated,
          totalResults: photos.length,
          timestamp: new Date().toISOString(),
          images: photos.slice(0, downloadLimit).map(photo => ({
            id: photo.id,
            photographer: photo.photographer,
            url: photo.url,
            thumbnail: photo.src.tiny,
            filename: `${photo.id}_${photo.photographer.replace(/\s+/g, '_').toLowerCase()}_${dirName}.jpg`
          }))
        }, null, 2)
      );

      // Save the current search state for future reference
      await this.saveSearchState(
        query, 
        options.page || DEFAULT_OPTIONS.page,
        useCurated
      );
      
      console.log(`\nDownload complete! Images saved to ${outputDir}`);
      console.log(`Downloaded ${downloadLimit} images for query: ${query} (page ${options.page || DEFAULT_OPTIONS.page})`);
      console.log(`JSON metadata files saved to ${jsonDir}`);
      console.log('Remember to follow Pexels\' attribution requirements: https://www.pexels.com/license/');
      
    } catch (error) {
      console.error('Error downloading images:', error.message);
      throw error;
    }
  }

  /**
   * Save the current search state to remember where you left off
   * @param {string} query - The search query
   * @param {number} page - The current page number
   * @param {boolean} useCurated - Whether this was a curated collection
   */
  async saveSearchState(query, page, useCurated) {
    try {
      const searchKey = query.replace(/,/g, '-').replace(/\s+/g, '_').toLowerCase();
      const stateDir = path.join('outputs', 'images', 'pexels', 'states');
      await fs.mkdir(stateDir, { recursive: true });
      
      const stateFile = path.join(stateDir, `${searchKey}_state.json`);
      const stateData = {
        query: query,
        lastPage: page,
        useCurated: useCurated,
        lastUpdated: new Date().toISOString()
      };
      
      await fs.writeFile(stateFile, JSON.stringify(stateData, null, 2));
      console.log(`Search state saved to ${stateFile}`);
      
      if (useCurated) {
        console.log(`Next time, use: npm run pexels curated --page=${page+1}`);
      } else {
        console.log(`Next time, use: npm run pexels "${query}" --page=${page+1}`);
      }
    } catch (error) {
      console.error('Error saving search state:', error.message);
    }
  }

  /**
   * List all saved search states
   */
  async listSearchStates() {
    try {
      const stateDir = path.join('outputs', 'images', 'pexels', 'states');
      await fs.mkdir(stateDir, { recursive: true });
      
      const files = await fs.readdir(stateDir);
      const stateFiles = files.filter(file => file.endsWith('_state.json'));
      
      if (stateFiles.length === 0) {
        console.log('No saved Pexels search states found.');
        return;
      }
      
      console.log('Previous Pexels searches:');
      for (const file of stateFiles) {
        const stateData = JSON.parse(await fs.readFile(path.join(stateDir, file), 'utf8'));
        if (stateData.useCurated) {
          console.log(`- Curated collection (Last page: ${stateData.lastPage})`);
          console.log(`  Command: npm run pexels curated --page=${stateData.lastPage+1}`);
        } else {
          console.log(`- Query: "${stateData.query}" (Last page: ${stateData.lastPage})`);
          console.log(`  Command: npm run pexels "${stateData.query}" --page=${stateData.lastPage+1}`);
        }
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
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) {
      console.error('Please set PEXELS_API_KEY in your .env file');
      process.exit(1);
    }

    // Parse command line arguments
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      console.error('Please provide a search query or "list" to see previous searches');
      console.error('Usage: npm run pexels <query> [options]');
      console.error('Example: npm run pexels "nature landscape" --page=2 --imageSize=large');
      console.error('To list previous searches: npm run pexels list');
      process.exit(1);
    }

    // Initialize image generator
    const imageGenerator = new PexelsImageGenerator(apiKey);
    
    // Check for "list" command
    if (args[0].toLowerCase() === 'list') {
      await imageGenerator.listSearchStates();
      return;
    }

    // First argument is the query
    const query = args[0];
    const useCurated = query.toLowerCase() === 'curated';
    
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
    if (useCurated) {
      console.log('Using curated collection instead of search');
      await imageGenerator.downloadImagesByQuery('curated', options, true);
    } else {
      await imageGenerator.downloadImagesByQuery(query, options, false);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
};

// Run the script
run();

module.exports = { PexelsImageGenerator };
