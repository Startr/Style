#!/usr/bin/env bash

# Set reference files and base directory
MAKEFILE_REF="/Users/somma/Documents/Projects/GitHub/WEB-Startr.Style/Makefile"
CONVENTION_REF="/Users/somma/Documents/Projects/GitHub/WEB-Startr.Style/CONVENTION.instructions.md"
BASE_DIR="/Users/somma/Documents/Projects/GitHub"
THRESHOLD=0.1  # Allow files that are 90% similar to be linked

# Function to check and link files based on similarity
link_if_similar() {
  local ref_file="$1"
  local target_file="$2"
  local threshold="$3"
  
  # Skip if it's the reference file itself
  if [ "$target_file" == "$ref_file" ]; then
    return
  fi
  
  # Calculate similarity
  total_lines=$(wc -l < "$ref_file")
  diff_lines=$(diff -y --suppress-common-lines "$ref_file" "$target_file" | wc -l)
  diff_ratio=$(awk "BEGIN {print $diff_lines/$total_lines}")
  
  # If similar enough, replace with hard link
  if (( $(awk "BEGIN {print ($diff_ratio < $threshold)}") )); then
    rm "$target_file"
    ln "$ref_file" "$target_file"
    echo "Linked: $target_file (${diff_ratio} difference)"
  else
    echo "Different: $target_file (${diff_ratio} difference)"
  fi
}

# Function to check if a file is already hard-linked
check_if_linked() {
  local file="$1"
  local link_count=$(stat -f %l "$file")
  
  if [ "$link_count" -gt 1 ]; then
    echo "Already linked: $file (link count: $link_count)"
    return 0
  else
    echo "Not linked: $file"
    return 1
  fi
}

# Process all Makefiles
echo "=== Processing Makefiles ==="
find "$BASE_DIR" -type f -name "Makefile" | while read -r makefile; do
  if check_if_linked "$makefile"; then
    continue
  fi
  link_if_similar "$MAKEFILE_REF" "$makefile" "$THRESHOLD"
done

# Process all CONVENTION.instructions.md files
echo -e "\n=== Processing CONVENTION.instructions.md files ==="
find "$BASE_DIR" -type f -name "CONVENTION.instructions.md" | while read -r convention_file; do
  if check_if_linked "$convention_file"; then
    continue
  fi
  link_if_similar "$CONVENTION_REF" "$convention_file" "$THRESHOLD"
done

echo -e "\nDone. All similar files have been replaced with hard links."