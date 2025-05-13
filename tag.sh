#!/usr/bin/env python3

import os
import sys
import random
import re
from pathlib import Path

# Check if posts directory was provided as argument
if len(sys.argv) < 2:
    print(f"Usage: {sys.argv[0]} <posts-directory>")
    print(f"Example: {sys.argv[0]} /Users/bradfisher/projects/_dev/PBN/leadcraftr/posts")
    sys.exit(1)

# Path to the posts directory from argument
posts_dir = sys.argv[1]

# Verify the directory exists
if not os.path.isdir(posts_dir):
    print(f"Error: Directory '{posts_dir}' does not exist.")
    sys.exit(1)

# List of tags to choose from
tags = [
    "Technology",
    "Marketing",
    "Automation",
    "Visualization",
    "Systems",
    "Data",
    "Optimization"
]

# Dictionary to track tag usage
tag_count = {tag: 0 for tag in tags}

# Counter for processed files
count = 0

print(f"Processing markdown files in: {posts_dir}")
print("-----------------------------------------")

# Process each markdown file in the posts directory
for file_path in Path(posts_dir).glob("*.md"):
    filename = file_path.name
    print(f"Processing: {filename}")
    
    # Get a random tag
    random_tag = random.choice(tags)
    
    # Read the file content
    with open(file_path, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # Check if the file already has tags
    if re.search(r'^tags:', content, re.MULTILINE):
        # Check if the file already has the random tag
        if re.search(rf'^\s+- {random_tag}$', content, re.MULTILINE):
            # Try to find a tag that isn't used yet
            available_tags = [tag for tag in tags if not re.search(rf'^\s+- {tag}$', content, re.MULTILINE)]
            if available_tags:
                random_tag = random.choice(available_tags)
            else:
                # If all tags are used, just stick with the original
                pass
        
        # Add the new tag
        # Find the last tag and add the new tag after it
        pattern = r"(tags:(?:\n\s+- [^\n]+)*)"
        replacement = r"\1\n  - " + random_tag
        new_content = re.sub(pattern, replacement, content)
    else:
        # If no tags section exists, add it after the image line
        pattern = r"(image: \"[^\"]+\")"
        replacement = r"\1\ntags:\n  - post\n  - " + random_tag
        new_content = re.sub(pattern, replacement, content)
    
    # Write the modified content back to the file
    with open(file_path, 'w', encoding='utf-8') as file:
        file.write(new_content)
    
    # Increment counters
    count += 1
    tag_count[random_tag] += 1
    
    print(f"Added tag: '{random_tag}' to {filename}")
    print("-----------------------------------------")

# Report on tag distribution
print("Tag distribution:")
for tag, count in tag_count.items():
    print(f"  {tag}: {count} files")

print(f"Completed! Processed {count} files.")