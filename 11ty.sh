#!/bin/bash

# ======================================
# CONFIGURATION SECTION
# ======================================

# Define the list of tags to choose from
TAGS=("Technology" "Marketing" "Automation" "Visualization" "Systems" "Data" "Optimization")

# Date range for random dates (in days)
MIN_DAYS_AGO=1
MAX_DAYS_AGO=200

# ======================================
# SCRIPT LOGIC BELOW
# ======================================

# Check if directory is provided as argument
if [ -z "$1" ]; then
    echo "Usage: ./11ty.sh <content-directory-path>"
    echo "Example: ./11ty.sh outputs/bulk/content"
    exit 1
fi

CONTENT_DIR="$1"
# Create a new directory for processed files by adding '_11ty' suffix to the original directory name
OUTPUT_DIR="${CONTENT_DIR}_11ty"
# Always use images directory inside the content directory
IMAGES_DIR="${CONTENT_DIR}/images"
OUTPUT_IMAGES_DIR="${OUTPUT_DIR}/images"

# Create the output directories if they don't exist
mkdir -p "$OUTPUT_DIR"
mkdir -p "$OUTPUT_IMAGES_DIR"
echo "Created output directories: $OUTPUT_DIR and $OUTPUT_IMAGES_DIR"
echo "Using images from: $IMAGES_DIR"

# Function to get a random tag
get_random_tag() {
    # Get a random index
    index=$((RANDOM % ${#TAGS[@]}))
    # Return the tag at that index
    echo "${TAGS[$index]}"
}

# Function to sanitize filename
sanitize_filename() {
    local sanitized=$(echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//')
    
    # Ensure filename is never empty
    if [ -z "$sanitized" ] || [ "$sanitized" = "-" ]; then
        sanitized="untitled-content-$(date +%s)"  # Add timestamp to ensure uniqueness
        echo "Warning: Empty filename after sanitization. Using '$sanitized' instead." >&2
    fi
    
    echo "$sanitized"
}

# Function to properly capitalize title (reusing from wp.sh)
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

# Function to get a random date between MIN_DAYS_AGO and MAX_DAYS_AGO
get_past_date() {
    # Generate random number of days within configured range
    days_ago=$((RANDOM % (MAX_DAYS_AGO - MIN_DAYS_AGO + 1) + MIN_DAYS_AGO))
    
    # Use perl to subtract the random days and format as YYYY-MM-DD
    perl -MPOSIX -e "
        \$days = $days_ago;
        \$time = time() - \$days*24*60*60;
        @t = localtime(\$time);
        printf \"%04d-%02d-%02d\n\", \$t[5]+1900, \$t[4]+1, \$t[3];
    "
}

# Initialize tag tracking
declare -A tag_counts
for tag in "${TAGS[@]}"; do
    tag_counts[$tag]=0
done

# Track total files processed
total_processed=0

# Process each markdown file
for file in "$CONTENT_DIR"/*.md; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        output_file="$OUTPUT_DIR/$filename"
        
        echo "Processing: $file"
        echo "Output will be saved to: $output_file"
        
        # Create temporary file
        temp_file=$(mktemp)
        
        # Extract the first heading
        title=$(grep -m 1 "^#" "$file" | sed 's/^#\s*//')
        
        # If no title found, use the filename or a default
        if [ -z "$title" ]; then
            title=$(basename "$file" .md)
            echo "Warning: No title found in $file, using filename as title: $title"
            # If title is still problematic, use a generic title
            if [ -z "$title" ] || [ "$title" = ".md" ]; then
                title="Untitled Content $(date +%s)"
                echo "Warning: Invalid title, using generic: $title"
            fi
        fi
        
        title=$(capitalize_title "$title")
        
        # Create sanitized filename for image
        sanitized_title=$(sanitize_filename "$title")
        
        # Find first image in images directory (supports jpg, jpeg, png, webp)
        image_file=$(find "$IMAGES_DIR" -maxdepth 1 -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" -o -name "*.webp" \) | head -n 1)
        
        if [ -n "$image_file" ]; then
            # Get image extension
            ext="${image_file##*.}"
            # Create new image name
            new_image_name="${sanitized_title}.${ext}"
            new_image_path="${OUTPUT_IMAGES_DIR}/${new_image_name}"
            
            # Copy and rename image
            cp "$image_file" "$new_image_path"
            echo "Copied image to: $new_image_path"
            
            # Update image path for markdown
            image_path="/media/${new_image_name}"
            
            # Move the image to processed directory to avoid reuse
            mv "$image_file" "${image_file}.processed"
        else
            echo "Warning: No image found for $filename, using default image path"
            image_path="/media/${sanitized_title}.webp"
        fi
        
        # Get date
        current_date=$(get_past_date)
        
        # Get a random tag for this file
        random_tag=$(get_random_tag)
        tag_counts[$random_tag]=$((tag_counts[$random_tag] + 1))
        
        # Write front matter and image to temp file
        cat > "$temp_file" << EOF
---
title: "${title}"
date: $current_date
image: "${image_path}"
tags:
  - post
  - ${random_tag}
---

![${title}](${image_path})

EOF
        
        # Append file content, skipping the heading and any blank lines immediately after it
        awk '
            BEGIN {heading_found=0; blank_after_heading=0}
            /^#/ {
                if (!heading_found) {
                    heading_found=1
                    next
                }
            }
            heading_found && /^$/ {
                if (!blank_after_heading) {
                    blank_after_heading=1
                    next
                }
            }
            heading_found {print}
        ' "$file" >> "$temp_file"
        
        # Move the processed content to the output file
        mv "$temp_file" "$output_file"
        
        echo "Added front matter, image, random tag '${random_tag}', and removed heading from: $output_file"
        
        # Increment total counter
        total_processed=$((total_processed + 1))
    fi
done

# Print tag distribution summary
echo "-----------------------------------------"
echo "Tag distribution:"
for tag in "${!tag_counts[@]}"; do
    echo "  ${tag}: ${tag_counts[$tag]} files"
done

echo "-----------------------------------------"
echo "Front matter addition complete! Processed ${total_processed} files."
echo "Output files are in: $OUTPUT_DIR"
