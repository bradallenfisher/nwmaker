#!/bin/bash

# Check if directory is provided as argument
if [ -z "$1" ]; then
    echo "Usage: ./11ty.sh <content-directory-path> [images-directory-path]"
    echo "Example: ./11ty.sh outputs/bulk/content outputs/images/pixabay/nature"
    exit 1
fi

CONTENT_DIR="$1"
# Create a new directory for processed files by adding '_11ty' suffix to the original directory name
OUTPUT_DIR="${CONTENT_DIR}_11ty"

# Check if images directory is provided as second argument, otherwise use default
if [ -n "$2" ]; then
    IMAGES_DIR="$2"
else
    IMAGES_DIR="${CONTENT_DIR}/images"
fi

OUTPUT_IMAGES_DIR="${OUTPUT_DIR}/images"

# Create the output directories if they don't exist
mkdir -p "$OUTPUT_DIR"
mkdir -p "$OUTPUT_IMAGES_DIR"
echo "Created output directories: $OUTPUT_DIR and $OUTPUT_IMAGES_DIR"
echo "Using images from: $IMAGES_DIR"

# Function to sanitize filename
sanitize_filename() {
    echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//'
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

# Function to get date from 36 hours ago
get_past_date() {
    # Use perl to subtract 36 hours (36*60*60 seconds) and format as YYYY-MM-DD
    perl -MPOSIX -e '
        $time = time() - 36*60*60;
        @t = localtime($time);
        printf "%04d-%02d-%02d\n", $t[5]+1900, $t[4]+1, $t[3];
    '
}

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
        
        # Write front matter and image to temp file
        cat > "$temp_file" << EOF
---
title: "${title}"
date: $current_date
image: "${image_path}"
tags:
  - post
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
        
        echo "Added front matter, image, and removed heading from: $output_file"
    fi
done

echo "Front matter addition complete! Processed files are in: $OUTPUT_DIR"
