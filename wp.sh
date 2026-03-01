#!/bin/bash

# Check if required arguments are provided
if [ "$#" -lt 4 ]; then
    echo "Usage: ./wp.sh <site-url> <username> <application-password> <content-root-dir> [category-id] [content-type]"
    echo "Example: ./wp.sh https://example.com admin xxxx-xxxx-xxxx-xxxx outputs/html [54] [post|page]"
    echo "Content type: 'post' (default) or 'page'"
    exit 1
fi

# Parameters
SITE_URL="${1%/}"  # Remove trailing slash if present
WP_USER="$2"
WP_APP_PASSWORD="$3"
ROOT_DIR="$4"

# Handle parameters 5 and 6 intelligently
if [ "$#" -eq 5 ]; then
    # Only 5 parameters provided - check if last one is 'page' or 'post'
    if [ "$5" = "page" ] || [ "$5" = "post" ]; then
        CONTENT_TYPE="$5"
        POST_CATEGORY="1"  # Default category for posts
    else
        POST_CATEGORY="$5"
        CONTENT_TYPE="post"  # Default to post
    fi
else
    # 6 parameters provided - traditional order
    POST_CATEGORY="${5:-1}"  # Default to category 1 if not specified
    CONTENT_TYPE="${6:-post}"  # Default to 'post' if not specified
fi

# Verify the root directory exists
if [ ! -d "$ROOT_DIR" ]; then
    echo "Error: Root directory '$ROOT_DIR' does not exist"
    exit 1
fi

# Function to properly capitalize title
capitalize_title() {
    echo "$1" | awk '
    function capitalize(word, first_word) {
        # Words to keep lowercase unless they are the first word
        small_words = "a an the of in on at for to with and but or nor"
        
        # Convert word to lowercase first
        word = tolower(word)
        
        # Always capitalize first word or if word is not in small_words list
        if (first_word || index(small_words, " " word " ") == 0) {
            return toupper(substr(word,1,1)) substr(word,2)
        }
        return word
    }
    {
        # Process each line
        for (i=1; i<=NF; i++) {
            # Capitalize based on position (first word or not)
            $i = capitalize($i, (i==1))
        }
        print
    }'
}

# Function to create WordPress content using REST API
create_content() {
    local title="$1"
    local content="$2"
    local status="$3"
    local post_date="$4"
    
    # Determine API endpoint based on content type
    local api_endpoint="posts"
    if [ "$CONTENT_TYPE" = "page" ]; then
        api_endpoint="pages"
    fi
    
    # Use Python to create the entire JSON payload
    local json_data=$(python3 -c "
import json, sys
data = {
    'title': '$title',
    'content': sys.stdin.read(),
    'status': '$status'
}
# Only add categories for posts, not pages
if '$CONTENT_TYPE' == 'post' and '$POST_CATEGORY' != 'page':
    data['categories'] = [$POST_CATEGORY]
if '$status' == 'future':
    data['date'] = '$post_date'
print(json.dumps(data))
" <<< "$content")
    
    # Make the API request and store the response
    response=$(curl -s -X POST \
         -H "Content-Type: application/json" \
         -H "Authorization: Basic $(echo -n "$WP_USER:$WP_APP_PASSWORD" | base64)" \
         -d "$json_data" \
         "$SITE_URL/wp-json/wp/v2/$api_endpoint")
    
    # Check if the request was successful
    if echo "$response" | grep -q "\"id\":" ; then
        echo "Success: $CONTENT_TYPE created successfully"
        content_id=$(echo "$response" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('id', 'unknown'))")
        echo "$(echo $CONTENT_TYPE | sed 's/./\U&/') ID: $content_id"
    else
        echo "Error: Failed to create $CONTENT_TYPE"
        echo "Response: $response"
    fi
}

echo "Starting bulk import from root directory: $ROOT_DIR"
echo "Content type: $CONTENT_TYPE"
echo "Finding all HTML files recursively..."

# Counter for tracking first content item
content_counter=0

# Find all HTML files recursively in the root directory
while IFS= read -r -d '' file; do
    filename=$(basename "$file")
    title="${filename%.html}"  # Remove .html extension
    title="${title//-/ }"    # Replace hyphens with spaces
    title=$(capitalize_title "$title")
    
    # Read content and remove h1 tags
    content=$(sed 's/<h1>.*<\/h1>//g' "$file")
    
    if [ $content_counter -eq 0 ]; then
        # First content item - publish immediately
        echo "Importing: $title (publishing now)"
        echo "From file: $file"
        create_content "$title" "$content" "publish"
        # Set post_date to current time for calculating next content items
        post_date=$(date +"%Y-%m-%d %H:%M:%S")
    else
        # Calculate next content date (current post_date + 1 day)
        post_date=$(date -v+24H -jf "%Y-%m-%d %H:%M:%S" "$post_date" +"%Y-%m-%d %H:%M:%S")
        echo "Importing: $title (scheduled for: $post_date)"
        echo "From file: $file"
        create_content "$title" "$content" "future" "$post_date"
    fi
    
    content_counter=$((content_counter + 1))
    
    # Add a small delay between requests to avoid overwhelming the API
    sleep 2
done < <(find "$ROOT_DIR" -type f -name "*.html" -print0)

echo "Import complete. Imported $content_counter ${CONTENT_TYPE}s."
