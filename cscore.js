const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const AIProviderFactory = require('./providers/AIProviderFactory');

dotenv.config();

/**
 * 
 * Also saves data to JSON and can analyze with Gemini
 */
async function checkContentScore(queryId) {
    try {
        const nwApiKey = process.env.NEURONWRITER_API_KEY;

        if (!nwApiKey) {
            console.error('Please set NEURONWRITER_API_KEY in your .env file');
            process.exit(1);
        }

        console.log(`Fetching data for query ID: ${queryId}...`);

        const baseUrl = 'https://app.neuronwriter.com/neuron-api/0.5/writer';
        const response = await axios.post(
            `${baseUrl}/get-query`,
            { query: queryId },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-KEY': nwApiKey
                }
            }
        );

        const data = response.data;

        // Check if competitors data exists
        if (!data.competitors || !Array.isArray(data.competitors) || data.competitors.length === 0) {
            console.log('No competitors data found in the response.');
            return;
        }

        console.log(`Found ${data.competitors.length} competitors for keyword: "${data.keyword}"`);
        console.log('='.repeat(80));

        // Create output directory structure
        const outputsDir = path.join(__dirname, 'outputs');
        const scoreDir = path.join(outputsDir, 'score');

        if (!fs.existsSync(outputsDir)) {
            fs.mkdirSync(outputsDir);
        }

        if (!fs.existsSync(scoreDir)) {
            fs.mkdirSync(scoreDir);
        }

        // Use the keyword from the data for the filename, sanitized as in bulk-generator.js
        const safeFilename = data.keyword
            ? data.keyword
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
            : `query-${queryId}`;

        const outputFile = path.join(scoreDir, `${safeFilename}.json`);
        fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
        console.log(`Data saved to ${outputFile}`);

        // Examine each competitor to check for content_score
        data.competitors.forEach((comp, index) => {
            console.log(`\nCompetitor #${index + 1}:`);
            console.log(`\tURL: ${comp.url}`);

            if (comp.rank !== undefined) console.log(`\tRANK: ${comp.rank}`);
            if (comp.title) console.log(`\tTITLE: ${comp.title}`);
            if (comp.desc) console.log(`\tDESC: ${comp.desc}`);

            // Check if content_score exists
            if (comp.content_score !== undefined) {
                console.log(`\tCONTENT SCORE: ${comp.content_score}`);
            } else {
                console.log(`\tCONTENT SCORE: Not available in data`);
            }

            // List all available properties for this competitor
            console.log('\tAvailable properties:');
            Object.keys(comp).forEach(key => {
                console.log(`\t\t- ${key}: ${typeof comp[key]}`);
            });
        });

        console.log('\n='.repeat(80));
        console.log('Full first competitor object for reference:');
        console.log(JSON.stringify(data.competitors[0], null, 2));

        // Analyze with Gemini
        await analyzeWithGemini(outputFile, data.keyword, queryId);

    } catch (error) {
        console.error('Error fetching data:', error.response?.data || error.message);
    }
}

async function analyzeWithGemini(jsonFile, queryName, queryId) {
    try {
        const geminiApiKey = process.env.GEMINI_API_KEY;

        if (!geminiApiKey) {
            console.error('Please set GEMINI_API_KEY in your .env file to use Gemini analysis');
            return;
        }

        console.log('\nAnalyzing data with Gemini AI...');

        // Read the JSON file
        const jsonData = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));

        // Create a customized prompt based on the data
        const prompt = createAnalysisPrompt(jsonData);

        // Initialize the Gemini provider
        const geminiProvider = AIProviderFactory.createProvider('gemini', geminiApiKey);

        // Generate content with Gemini
        const analysis = await geminiProvider.generateContent(prompt);

        // Save the analysis to the same directory with _analysis suffix
        const analysisFile = jsonFile.replace('.json', '_analysis.md');
        fs.writeFileSync(analysisFile, analysis);

        // Save metadata to include both keyword and query ID
        const metadataFile = jsonFile.replace('.json', '_metadata.json');
        const metadata = {
            queryId: queryId,
            keyword: queryName,
            analysisTimestamp: new Date().toISOString(),
            analysisFile: path.basename(analysisFile)
        };
        fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));

        console.log(`Analysis complete! Results saved to ${analysisFile}`);
        console.log(`Metadata saved to ${metadataFile}`);

    } catch (error) {
        console.error('Error analyzing with Gemini:', error.message);
    }
}

function createAnalysisPrompt(jsonData) {
    // Extract relevant data for the prompt
    const keyword = jsonData.keyword || 'unknown keyword';
    const competitors = jsonData.competitors || [];

    // Extract and format key sections from the data
    const formattedData = {
        // Core information
        keyword: keyword,
        language: jsonData.language,

        // Metrics data
        metrics: jsonData.metrics || {},

        // Terms data
        terms: {
            title: formatTermsList(jsonData.terms?.title || []),
            desc: formatTermsList(jsonData.terms?.desc || []),
            h1: formatTermsList(jsonData.terms?.h1 || []),
            h2: formatTermsList(jsonData.terms?.h2 || []),
            content_basic: formatTermsList(jsonData.terms?.content_basic || []),
            content_extended: formatTermsList(jsonData.terms?.content_extended || []),
            entities: formatTermsList(jsonData.terms?.entities || [])
        },

        // Terms text data (condensed version)
        terms_txt: jsonData.terms_txt || {},

        // Questions data
        questions: {
            suggest_questions: extractQuestions(jsonData.ideas?.suggest_questions || []),
            people_also_ask: extractQuestions(jsonData.ideas?.people_also_ask || []),
            content_questions: extractQuestions(jsonData.ideas?.content_questions || [])
        },

        // Competitor summary
        competitors_summary: competitors.map(comp => ({
            rank: comp.rank,
            url: comp.url,
            title: comp.title,
            desc: comp.desc,
            content_score: comp.content_score,
            readability: comp.readability,
            word_count: comp.word_count,
            content_len: comp.content_len
        }))
    };

    // Calculate averages for competitor metrics
    const avgMetrics = {
        content_score: calculateAverage(competitors, 'content_score'),
        readability: calculateAverage(competitors, 'readability'),
        word_count: calculateAverage(competitors, 'word_count'),
        content_len: calculateAverage(competitors, 'content_len')
    };

    // Extract top headers from competitors for outline inspiration
    const topHeaders = extractTopHeaders(competitors);

    // Create a custom analysis prompt highlighting the key data points
    const customPrompt = `
Analyze the following NeuronWriter data for the keyword "${keyword}":

KEYWORD ANALYSIS METRICS:
------------------------
Main Keyword: ${keyword}
Language: ${jsonData.language}
Target Word Count: ${jsonData.metrics?.word_count?.target || 'N/A'}
Target Readability: ${jsonData.metrics?.readability?.target || 'N/A'}
Competitors: ${competitors.length}

COMPETITOR METRICS AVERAGES:
--------------------------
Content Score: ${avgMetrics.content_score}
Readability: ${avgMetrics.readability}
Word Count: ${avgMetrics.word_count}
Content Length: ${avgMetrics.content_len} characters

TOP COMPETITORS:
--------------
${formatTopCompetitors(competitors.slice(0, 5))}

KEY TERMS TO USE:
---------------
TITLE TERMS: ${formattedData.terms.title}
DESCRIPTION TERMS: ${formattedData.terms.desc}
H1 TERMS: ${formattedData.terms.h1}
H2 TERMS: ${formattedData.terms.h2}
BASIC CONTENT TERMS: ${formattedData.terms.content_basic.slice(0, 15)}
EXTENDED CONTENT TERMS: ${formattedData.terms.content_extended.slice(0, 15)}

TOP QUESTIONS TO ANSWER:
----------------------
${formatTopQuestions(jsonData)}

COMPETITOR HEADERS FOR OUTLINE INSPIRATION:
----------------------------------------
${topHeaders}

ANALYSIS TASKS:
-------------
1. Based on the data above, provide a comprehensive content strategy for a piece on "${keyword}"
2. Create an optimized outline that covers all key topics and questions
3. Recommend word count, readability targets, and key terms to include
4. Highlight content gaps in competitor articles that should be filled
  - this is very important, we need to fill the gaps in the competitor articles.
5. Suggest unique angles or sections to help this content outperform competitors
  - this is very important, we need to be unique and different from the competitors.

Include specific recommendations for:
- Title and meta description optimization
- Header structure
- Content organization
- Key terms to emphasize
- Questions to answer comprehensively
- Target metrics for success

FULL DATA CONTEXT:
The complete NeuronWriter data is available for reference, but focus your analysis on the key points highlighted above.
`;

    return customPrompt;
}

// Helper functions for formatting the data
function formatTermsList(terms) {
    return terms.map(term => typeof term === 'object' ? term.t : term).join(', ');
}

function extractQuestions(questionsArray) {
    return questionsArray.map(item => item.q);
}

function formatTopCompetitors(competitors) {
    return competitors.map(comp =>
        `#${comp.rank}: ${comp.url}\n   Title: ${comp.title}\n   Content Score: ${comp.content_score || 'N/A'}, Readability: ${comp.readability || 'N/A'}, Word Count: ${comp.word_count || 'N/A'}`
    ).join('\n\n');
}

function formatTopQuestions(jsonData) {
    const allQuestions = [];

    // Add suggested questions
    if (jsonData.ideas?.suggest_questions) {
        allQuestions.push(...jsonData.ideas.suggest_questions.slice(0, 5).map(q => `- ${q.q} [suggest]`));
    }

    // Add people also ask questions
    if (jsonData.ideas?.people_also_ask) {
        allQuestions.push(...jsonData.ideas.people_also_ask.slice(0, 5).map(q => `- ${q.q} [PAA]`));
    }

    // Add content questions
    if (jsonData.ideas?.content_questions) {
        allQuestions.push(...jsonData.ideas.content_questions.slice(0, 5).map(q => `- ${q.q} [content]`));
    }

    return allQuestions.join('\n');
}

function extractTopHeaders(competitors) {
    // Get h1 and h2 headers from top competitors
    const headers = [];

    competitors.slice(0, 3).forEach(comp => {
        if (comp.headers && Array.isArray(comp.headers)) {
            comp.headers.forEach(header => {
                if (header[0] === 'h1' || header[0] === 'h2') {
                    headers.push(`${header[0].toUpperCase()}: ${header[1]}`);
                }
            });
        }
    });

    // Return a limited set of headers
    return headers.slice(0, 15).join('\n');
}

// Helper function to calculate average for a given metric
function calculateAverage(items, metric) {
    const validValues = items
        .map(item => item[metric])
        .filter(value => value !== null && value !== undefined && !isNaN(Number(value)));

    if (validValues.length === 0) return 'N/A';

    const sum = validValues.reduce((acc, val) => acc + Number(val), 0);
    return Math.round(sum / validValues.length);
}

// Check command line arguments
const queryId = process.argv[2];

if (!queryId) {
    console.error('Please provide a NeuronWriter query ID');
    console.error('Usage: node cscore.js <queryId>');
    process.exit(1);
}

// Run the script
checkContentScore(queryId);
