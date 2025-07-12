const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

// Default processing options
const DEFAULT_OPTIONS = {
  outputFormat: 'webp',    // Output format: 'webp', 'jpeg', 'png'
  outputWidth: 1000,       // Target width in pixels
  webpQuality: 80,         // WebP quality (0-100, higher is better quality)
  deleteOriginals: false,  // Whether to delete original images after processing
  processAll: true         // Process all images regardless of current format
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
    
    // Filter for image files
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'];
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
      
      // Create a unique temporary output filename to avoid conflicts
      const timestamp = Date.now();
      const tempOutputFilename = `${fileInfo.name}_temp_${timestamp}.${settings.outputFormat}`;
      const tempOutputPath = path.join(inputDir, tempOutputFilename);
      
      // Final output filename (same name but with the target extension)
      const finalOutputFilename = `${fileInfo.name}.${settings.outputFormat}`;
      const finalOutputPath = path.join(inputDir, finalOutputFilename);
      
      try {
        console.log(`Processing: ${file} -> ${finalOutputFilename}`);
        
        // Create a Sharp instance with the input file
        const image = sharp(inputPath);
        
        // Get image metadata
        const metadata = await image.metadata();
        
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
        
        // Save the processed image to temporary file first
        await processedImage.toFile(tempOutputPath);
        
        // Get stats to calculate size reduction
        const originalStat = await fs.stat(inputPath);
        const processedStat = await fs.stat(tempOutputPath);
        const reduction = (1 - (processedStat.size / originalStat.size)) * 100;
        
        // If input file has the same name as the final output file, we need to:
        // 1. Delete the original (if it's not the same file)
        // 2. Rename the temp file to the final name
        if (file !== finalOutputFilename) {
          // Different filename - delete original if requested
          if (settings.deleteOriginals) {
            await fs.unlink(inputPath);
            console.log(`Deleted original: ${file}`);
          }
          // Rename temp to final
          await fs.rename(tempOutputPath, finalOutputPath);
        } else {
          // Same filename - need to replace original with temp
          await fs.unlink(inputPath);
          await fs.rename(tempOutputPath, finalOutputPath);
        }
        
        console.log(`Saved: ${finalOutputFilename} (${processedStat.size} bytes, ${reduction.toFixed(1)}% reduction)`);
        processed++;
      } catch (error) {
        console.error(`Error processing ${file}:`, error.message);
        
        // Clean up temp file if it exists
        try {
          await fs.access(tempOutputPath);
          await fs.unlink(tempOutputPath);
        } catch (e) {
          // Temp file doesn't exist or couldn't be deleted, ignore
        }
        
        errors++;
      }
    }
    
    console.log(`Processing complete: ${processed} processed, ${skipped} skipped, ${errors} errors`);
  } catch (error) {
    console.error('Error processing directory:', error.message);
  }
}

// CLI interface
async function main() {
  // Get directory from command line arguments
  const args = process.argv.slice(2);
  const inputDir = args[0];
  
  if (!inputDir) {
    console.error('Usage: node process-images.js <directory-path> [options]');
    console.error('Options:');
    console.error('  --format=<webp|jpeg|png>  Output format (default: webp)');
    console.error('  --width=<pixels>          Target width (default: 1000)');
    console.error('  --quality=<0-100>         Quality (default: 80)');
    console.error('  --delete-originals        Delete original files after processing');
    process.exit(1);
  }
  
  // Parse options
  const options = {};
  args.slice(1).forEach(arg => {
    if (arg.startsWith('--format=')) {
      options.outputFormat = arg.split('=')[1];
    } else if (arg.startsWith('--width=')) {
      options.outputWidth = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--quality=')) {
      options.webpQuality = parseInt(arg.split('=')[1]);
    } else if (arg === '--delete-originals') {
      options.deleteOriginals = true;
    }
  });
  
  await processImagesInDirectory(inputDir, options);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { processImagesInDirectory };