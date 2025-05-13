const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

// Default processing options
const DEFAULT_OPTIONS = {
  outputFormat: 'webp',  // Output format: 'webp', 'jpeg', 'png'
  outputWidth: 1000,     // Target width in pixels
  webpQuality: 80,       // WebP quality (0-100, higher is better quality)
  deleteOriginals: false // Whether to delete original images after processing
};

/**
 * Process all images in a directory
 * @param {string} inputDir - Directory containing images to process
 * @param {Object} options - Processing options
 */
async function processImagesInDirectory(inputDir, options = {}) {
  try {
    console.log(`Processing images in: ${inputDir}`);
    
    // Merge default options with provided options
    const settings = { ...DEFAULT_OPTIONS, ...options };
    console.log('Processing settings:', settings);
    
    // Get all files in the directory
    const files = await fs.readdir(inputDir);
    
    // Filter for image files (simple extension-based check)
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff'];
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return imageExtensions.includes(ext);
    });
    
    if (imageFiles.length === 0) {
      console.log('No image files found in the directory.');
      return;
    }
    
    console.log(`Found ${imageFiles.length} images to process.`);
    
    // Process each image
    let processed = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const file of imageFiles) {
      const inputPath = path.join(inputDir, file);
      const fileInfo = path.parse(file);
      const outputFilename = `${fileInfo.name}.${settings.outputFormat}`;
      const outputPath = path.join(inputDir, outputFilename);
      
      // Skip if output file already exists and has the same name
      if (file === outputFilename) {
        console.log(`Skipping already processed file: ${file}`);
        skipped++;
        continue;
      }
      
      try {
        console.log(`Processing: ${file} -> ${outputFilename}`);
        
        // Create a Sharp instance with the input file
        const image = sharp(inputPath);
        
        // Get image metadata
        const metadata = await image.metadata();
        console.log(`Original image: ${metadata.width}x${metadata.height} ${metadata.format}`);
        
        // Process the image
        const processedImage = image
          .resize({
            width: settings.outputWidth,
            withoutEnlargement: true // Don't enlarge if smaller than target
          });
          
        // Set format-specific options
        if (settings.outputFormat === 'webp') {
          processedImage.webp({ quality: settings.webpQuality });
        } else if (settings.outputFormat === 'jpeg') {
          processedImage.jpeg({ quality: settings.webpQuality });
        } else if (settings.outputFormat === 'png') {
          processedImage.png({ quality: settings.webpQuality });
        }
        
        // Save the processed image
        await processedImage.toFile(outputPath);
        
        // Get stats of both files to calculate size reduction
        const originalStat = await fs.stat(inputPath);
        const processedStat = await fs.stat(outputPath);
        const reduction = (1 - (processedStat.size / originalStat.size)) * 100;
        
        console.log(`Saved: ${outputFilename} (${processedStat.size} bytes, ${reduction.toFixed(1)}% reduction)`);
        
        // Delete original if requested
        if (settings.deleteOriginals && fileInfo.ext.toLowerCase() !== `.${settings.outputFormat}`) {
          await fs.unlink(inputPath);
          console.log(`Deleted original: ${file}`);
        }
        
        processed++;
      } catch (err) {
        console.error(`Error processing ${file}:`, err.message);
        errors++;
      }
    }
    
    console.log('\nProcessing complete!');
    console.log(`Processed: ${processed} images`);
    console.log(`Skipped: ${skipped} images`);
    console.log(`Errors: ${errors} images`);
    
  } catch (error) {
    console.error('Error processing directory:', error.message);
  }
}

// Main execution function
async function run() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      console.error('Please provide a directory to process');
      console.error('Usage: node process-images.js <directory> [options]');
      console.error('Example: node process-images.js ./image-library/pixabay/nature --outputFormat=webp --outputWidth=1000');
      process.exit(1);
    }
    
    // First argument is the directory
    const inputDir = args[0];
    
    // Parse options from remaining arguments
    const options = {};
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--')) {
        const [key, value] = arg.slice(2).split('=');
        // Convert numeric values
        if (!isNaN(value)) {
          options[key] = parseInt(value);
        } else if (value === 'true' || value === 'false') {
          options[key] = value === 'true';
        } else {
          options[key] = value;
        }
      }
    }
    
    // Process the directory
    await processImagesInDirectory(inputDir, options);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run the script
run();