#!/bin/bash

# Check if required arguments are provided
if [ "$#" -lt 4 ]; then
    echo "Usage: ./wp.sh <site-url> <username> <application-password> <content-root-dir> [category-id]"
    echo "Example: ./wp.sh https://example.com admin xxxx-xxxx-xxxx-xxxx outputs/html [54]"
    exit 1
fi

# Parameters
SITE_URL="${1%/}"  # Remove trailing slash if present
WP_USER="$2"
WP_APP_PASSWORD="$3"
ROOT_DIR="$4"
POST_CATEGORY="${5:-1}"  # Default to category 1 if not specified

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

# Function to create WordPress post using REST API
create_post() {
    local title="$1"
    local content="$2"
    local status="$3"
    local post_date="$4"
    
    # Use Python to create the entire JSON payload
    local json_data=$(python3 -c "
import json, sys
data = {
    'title': '$title',
    'content': sys.stdin.read(),
    'status': '$status',
    'categories': [$POST_CATEGORY]
}
if '$status' == 'future':
    data['date'] = '$post_date'
print(json.dumps(data))
" <<< "$content")
    
    # Make the API request and store the response
    response=$(curl -s -X POST \
         -H "Content-Type: application/json" \
         -H "Authorization: Basic $(echo -n "$WP_USER:$WP_APP_PASSWORD" | base64)" \
         -d "$json_data" \
         "$SITE_URL/wp-json/wp/v2/posts")
    
    # Check if the request was successful
    if echo "$response" | grep -q "\"id\":" ; then
        echo "Success: Post created successfully"
        post_id=$(echo "$response" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('id', 'unknown'))")
        echo "Post ID: $post_id"
    else
        echo "Error: Failed to create post"
        echo "Response: $response"
    fi
}

echo "Starting bulk import from root directory: $ROOT_DIR"
echo "Finding all HTML files recursively..."

# Counter for tracking first post
post_counter=0

# Find all HTML files recursively in the root directory
while IFS= read -r -d '' file; do
    filename=$(basename "$file")
    title="${filename%.html}"  # Remove .html extension
    title="${title//-/ }"    # Replace hyphens with spaces
    title=$(capitalize_title "$title")
    
    # Read content and remove h1 tags
    content=$(sed 's/<h1>.*<\/h1>//g' "$file")
    
    if [ $post_counter -eq 0 ]; then
        # First post - publish immediately
        echo "Importing: $title (publishing now)"
        echo "From file: $file"
        create_post "$title" "$content" "publish"
        # Set post_date to current time for calculating next posts
        post_date=$(date +"%Y-%m-%d %H:%M:%S")
    else
        # Calculate next post date (current post_date + 1 day)
        post_date=$(date -v+24H -jf "%Y-%m-%d %H:%M:%S" "$post_date" +"%Y-%m-%d %H:%M:%S")
        echo "Importing: $title (scheduled for: $post_date)"
        echo "From file: $file"
        create_post "$title" "$content" "future" "$post_date"
    fi
    
    post_counter=$((post_counter + 1))
    
    # Add a small delay between requests to avoid overwhelming the API
    sleep 2
done < <(find "$ROOT_DIR" -type f -name "*.html" -print0)

echo "Import complete. Imported $post_counter posts."
