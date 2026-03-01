# NW Prompt Builder

A comprehensive content generation tool that integrates with NeuronWriter API and AI providers (Google Gemini/OpenAI) to generate SEO-optimized content prompts, articles, and manage image assets for WordPress sites.

## Features

- **Content Generation**: Generate SEO-optimized article prompts using NeuronWriter keyword data
- **AI Integration**: Supports Google Gemini and OpenAI for content generation
- **Bulk Processing**: Process single queries or entire projects with optional tag filtering
- **Question-Based Content**: Generate blog posts from People Also Ask and content questions
- **Image Management**: Download and process images from Pixabay and Pexels
- **WordPress Integration**: Import generated content directly to WordPress sites
- **Template System**: Customizable prompt templates for different content types

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd nwmaker
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
# NeuronWriter API
NEURONWRITER_API_KEY=your_neuronwriter_api_key

# AI Provider (choose one or both)
AI_PROVIDER=gemini  # or 'openai'
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key

# Image APIs (optional)
PIXABAY_API_KEY=your_pixabay_api_key
PEXELS_API_KEY=your_pexels_api_key
```

## Project Structure

```
nwmaker/
├── inputs/              # Default prompt templates
│   ├── prompt-top.txt
│   ├── prompt-outline.txt
│   ├── prompt-commands.txt
│   ├── prompt-bulk.txt
│   └── prompt-bulk-titles.txt
├── inputsLC/            # Alternative input templates
├── outputs/             # Generated content
│   ├── html/           # HTML files
│   ├── md/             # Markdown files
│   └── questions/      # Question-based content
├── image-library/       # Downloaded images
│   ├── pixabay/
│   └── pexels/
├── providers/          # AI provider implementations
│   ├── AIProvider.js
│   ├── AIProviderFactory.js
│   ├── GeminiProvider.js
│   └── OpenAIProvider.js
├── archive/            # Archived generated content
└── wp.sh              # WordPress import script
```

## Usage

### Content Generation

#### Generate Prompt for Single Query
Process a single NeuronWriter query to generate a content prompt:
```bash
npm run bulk <queryId>
```

**Example:**
```bash
npm run bulk 30b24053c54b2bb5
```

**Output:**
- `outputs/{keyword}-prompt.json` - Full prompt with metadata
- `outputs/questions/questions-{queryId}.json` - Extracted questions

#### Generate Prompts for Entire Project
Process all queries in a NeuronWriter project:
```bash
npm run bulk-project <projectId> [tags...]
```

**Examples:**
```bash
# Process all queries in project
npm run bulk-project 30b24053c54b2bb5

# Process only queries with specific tags
npm run bulk-project 30b24053c54b2bb5 tag1 tag2
```

**Output:**
- Generates prompts for all matching queries
- Each query creates its own prompt file and questions file

### Article Generation

Generate full articles from prompt files:
```bash
npm run article <promptFile>
```

**Example:**
```bash
npm run article outputs/kitchen-remodeling-prompt.json
```

**Output:**
- Markdown and HTML versions of the article
- Option to import directly to NeuronWriter

### Question-Based Content

#### Generate Posts from Questions
Generate blog posts answering questions from NeuronWriter data:
```bash
npm run questions <queryId>
```

**Example:**
```bash
npm run questions 30b24053c54b2bb5
```

**Output:**
- Individual blog posts for each question
- Saved in `outputs/questions/posts/`

#### List Available Question Sets
View all available question sets:
```bash
npm run question-list
```

### Image Management

#### Download from Pixabay
Download images from Pixabay with custom filenames:
```bash
npm run pixabay "<search terms>" [custom_args] [options]
```

**Examples:**
```bash
# Basic usage
npm run pixabay "kitchen interior design"

# With custom filename arguments
npm run pixabay "kitchen interior design" "dz_renovations" "state_college" "16801"

# With options
npm run pixabay "kitchen interior design" --page=2 --imageType=photo --limit=50
```

**Custom Filename Format:**
- `kitchen interior design dz_renovations state_college 16801 1.jpeg`
- `kitchen interior design dz_renovations state_college 16801 2.jpeg`
- etc.

**Options:**
- `--limit=N` - Number of images to download (default: 200)
- `--page=N` - Page number (default: 1)
- `--imageType=photo|illustration|vector|all` - Image type filter
- `--imageSize=original|large|medium` - Image size
- `--orientation=horizontal|vertical|all` - Orientation filter
- `--outputFormat=webp|jpeg|png` - Output format (default: jpeg)
- `--outputWidth=N` - Target width in pixels (default: 1000)
- `--processImages=true|false` - Enable/disable image processing (default: true)

**Output:**
- Images saved to `image-library/pixabay/{search_terms}/`
- Metadata saved to `image-library/pixabay/{search_terms}/json/`

#### Download from Pexels
Download images from Pexels with custom filenames:
```bash
npm run pexels "<search query>" [custom_args] [options]
```

**Examples:**
```bash
# Basic usage
npm run pexels "kitchen interior design"

# With custom filename arguments
npm run pexels "kitchen interior design" "dz_renovations" "state_college" "16801"

# With options
npm run pexels "kitchen interior design" --page=2 --imageSize=large --limit=50
```

**Options:**
- `--limit=N` - Number of images to download (default: 50)
- `--page=N` - Page number (default: 1)
- `--imageSize=original|large|medium|small` - Image size
- `--orientation=landscape|portrait|square` - Orientation filter
- `--color=red|blue|etc` - Color filter
- `--outputFormat=webp|jpeg|png` - Output format (default: webp)
- `--outputWidth=N` - Target width in pixels (default: 1000)
- `--processImages=true|false` - Enable/disable image processing (default: true)

**Output:**
- Images saved to `image-library/pexels/{search_query}/`
- Metadata saved to `image-library/pexels/{search_query}/json/`

#### Process Images
Process existing images (resize, convert format, etc.):
```bash
npm run process-images
```

### WordPress Import

Import generated HTML files to WordPress as posts or pages:
```bash
./wp.sh <site-url> <username> <application-password> <content-root-dir> [category-id] [content-type]
```

**Examples:**
```bash
# Import as pages (no category needed)
./wp.sh https://example.com admin xxxx-xxxx-xxxx-xxxx outputs/html page

# Import as posts with category
./wp.sh https://example.com admin xxxx-xxxx-xxxx-xxxx outputs/html 53 post

# Import as posts (default)
./wp.sh https://example.com admin xxxx-xxxx-xxxx-xxxx outputs/html 53
```

**Features:**
- Automatically removes HTML document structure, meta tags, and H1 tags
- First content item publishes immediately
- Subsequent items scheduled 1 day apart
- Supports both posts and pages
- Properly formats titles from filenames

**Note:** HTML files should contain only body content (no DOCTYPE, html, head, or body tags).

### Stability AI (Optional)

Generate images using Stability AI:
```bash
npm run stability
```

## Configuration

### Prompt Templates

Customize content generation by editing template files in the `inputs/` directory:

- **`prompt-top.txt`** - Main content generation prompt template
- **`prompt-outline.txt`** - Outline generation template
- **`prompt-commands.txt`** - Command instructions template
- **`prompt-bulk.txt`** - Bulk article generation template
- **`prompt-bulk-titles.txt`** - Title generation template

Templates support variables like:
- `{keyword}` - Main keyword
- `{titleTermsList}` - Title/H1/H2 terms
- `{basicTermsList}` - Basic content terms
- `{entitiesList}` - Entities with importance metrics
- `{questions}` - People Also Ask questions

### Multiple Input Sets

You can create different input template sets:
- `inputs/` - Default templates
- `inputsLC/` - Alternative template set
- `inputs_eger/` - Another template set

## Workflow Example

1. **Generate Prompts:**
   ```bash
   npm run bulk-project 30b24053c54b2bb5
   ```

2. **Generate Articles:**
   ```bash
   npm run article outputs/kitchen-remodeling-prompt.json
   ```

3. **Download Images:**
   ```bash
   npm run pixabay "kitchen interior design" "dz_renovations" "state_college" "16801"
   ```

4. **Import to WordPress:**
   ```bash
   ./wp.sh https://example.com admin xxxx-xxxx-xxxx-xxxx outputs/html page
   ```

## Output Files

### Prompt Files
- **Format:** JSON
- **Location:** `outputs/{keyword}-prompt.json`
- **Contains:** Full prompt, metadata, keyword, query ID

### Question Files
- **Format:** JSON
- **Location:** `outputs/questions/questions-{queryId}.json`
- **Contains:** All questions from NeuronWriter (suggest, PAA, content)

### Article Files
- **Markdown:** `outputs/md/{title}.md`
- **HTML:** `outputs/html/{title}.html`
- **Prompt JSON:** `outputs/{keyword}/{title}-prompt.json`

### Image Files
- **Images:** `image-library/{source}/{search_terms}/{filename}`
- **Metadata:** `image-library/{source}/{search_terms}/json/{id}_metadata.json`
- **Search Results:** `image-library/{source}/{search_terms}/json/search_results.json`

## API Requirements

### NeuronWriter API
- Required for content generation
- Get API key from: https://app.neuronwriter.com

### AI Provider
- **Google Gemini** (recommended) or **OpenAI**
- Gemini API: https://makersuite.google.com/app/apikey
- OpenAI API: https://platform.openai.com/api-keys

### Image APIs (Optional)
- **Pixabay**: https://pixabay.com/api/docs/
- **Pexels**: https://www.pexels.com/api/

## Troubleshooting

### Common Issues

**"Please set NEURONWRITER_API_KEY"**
- Ensure `.env` file exists with valid API keys

**"Model overloaded"**
- The script automatically retries with exponential backoff
- Wait a few seconds and try again

**WordPress import fails**
- Verify application password is correct
- Check that HTML files are properly formatted (no full HTML structure)
- Ensure WordPress REST API is enabled

**No images found**
- Check API key is valid
- Try different search terms
- Adjust filters (orientation, image type, etc.)

## License

[Add your license information here]

## Contributing

[Add contribution guidelines here]

## Support

[Add support information here]

