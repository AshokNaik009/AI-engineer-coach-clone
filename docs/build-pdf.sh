#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
#---------------------------------------------------------------------------------------------
#
# Build a PDF from the Hugo Markdown content.
#
# Prerequisites:
#   brew install pandoc typst
#   (alternative engines: pip install weasyprint, or brew install basictex)
#
# Usage:
#   cd docs && bash build-pdf.sh
#   # produces ai-engineer-coach.pdf in the docs/ directory

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTENT_DIR="$SCRIPT_DIR/content"
SCREENSHOT_DIR="$SCRIPT_DIR/public/screenshots"
OUTPUT="$SCRIPT_DIR/ai-engineer-coach.pdf"
TMPDIR_PDF="$(mktemp -d)"
COMBINED="$TMPDIR_PDF/combined.md"

trap 'rm -rf "$TMPDIR_PDF"' EXIT

# Copy screenshots into temp dir so relative paths work with all engines
mkdir -p "$TMPDIR_PDF/screenshots"
if [[ -d "$SCREENSHOT_DIR" ]]; then
  cp "$SCREENSHOT_DIR"/* "$TMPDIR_PDF/screenshots/" 2>/dev/null || true
fi

# --- Ordered list of Markdown files matching the site navigation ---
FILES=(
  "$CONTENT_DIR/_index.md"
  "$CONTENT_DIR/getting-started/_index.md"
  "$CONTENT_DIR/getting-started/installation.md"
  "$CONTENT_DIR/getting-started/supported-tools.md"
  "$CONTENT_DIR/features/_index.md"
  "$CONTENT_DIR/observe/_index.md"
  "$CONTENT_DIR/observe/dashboard.md"
  "$CONTENT_DIR/observe/timeline.md"
  "$CONTENT_DIR/measure/_index.md"
  "$CONTENT_DIR/measure/output.md"
  "$CONTENT_DIR/measure/burndown.md"
  "$CONTENT_DIR/measure/patterns.md"
  "$CONTENT_DIR/improve/_index.md"
  "$CONTENT_DIR/improve/anti-patterns.md"
  "$CONTENT_DIR/improve/skill-finder.md"
  "$CONTENT_DIR/improve/context-health.md"
  "$CONTENT_DIR/level-up/_index.md"
  "$CONTENT_DIR/level-up/sdlc.md"
  "$CONTENT_DIR/level-up/achievements.md"
  "$CONTENT_DIR/level-up/learning.md"
  "$CONTENT_DIR/level-up/share.md"
)

# --- Title block for pandoc ---
cat > "$COMBINED" <<'EOF'
---
title: "AI Engineer Coach"
subtitle: "Documentation"
author: "Microsoft"
---

EOF

# --- Concatenate files, stripping YAML front matter and rewriting image paths ---
for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "Warning: missing $f, skipping" >&2
    continue
  fi

  # Strip YAML front matter (lines between --- delimiters at the top)
  content=$(awk '
    BEGIN { in_front=0; seen_end=0 }
    NR==1 && /^---/ { in_front=1; next }
    in_front && /^---/ { in_front=0; seen_end=1; next }
    in_front { next }
    { print }
  ' "$f")

  # Remove Hugo shortcodes: [text]({{< ref "..." >}}) -> text
  content=$(echo "$content" | sed -E 's/\[([^]]*)\]\(\{\{<[^>]*>\}\}\)/\1/g')

  # Rewrite absolute image paths (/screenshots/...) to relative paths in temp dir
  content=$(echo "$content" | sed -E "s|(/screenshots/)|screenshots/|g")

  printf '%s\n\n' "$content" >> "$COMBINED"
done

echo "Combined Markdown: $(wc -l < "$COMBINED") lines"

# --- Detect PDF engine ---
if command -v typst &>/dev/null; then
  ENGINE_ARGS=("--pdf-engine=typst")
  echo "Using typst"
elif command -v weasyprint &>/dev/null; then
  ENGINE_ARGS=("--pdf-engine=weasyprint")
  echo "Using weasyprint"
elif command -v xelatex &>/dev/null; then
  ENGINE_ARGS=("--pdf-engine=xelatex")
  echo "Using xelatex"
elif command -v pdflatex &>/dev/null; then
  ENGINE_ARGS=("--pdf-engine=pdflatex")
  echo "Using pdflatex"
elif command -v lualatex &>/dev/null; then
  ENGINE_ARGS=("--pdf-engine=lualatex")
  echo "Using lualatex"
else
  echo "Error: No PDF engine found." >&2
  echo "Install one of: typst (brew install typst), weasyprint (pip install weasyprint), basictex (brew install basictex)" >&2
  exit 1
fi

# --- Build PDF ---
(cd "$TMPDIR_PDF" && pandoc "$COMBINED" \
  -o "$OUTPUT" \
  "${ENGINE_ARGS[@]}" \
  --standalone \
  --toc \
  --toc-depth=2 \
  --resource-path="$TMPDIR_PDF" \
  --metadata=geometry:margin=1in \
  -V colorlinks=true \
  -V linkcolor=blue \
  -V mainfont="Helvetica" \
  -V monofont="Courier")

echo "PDF written to $OUTPUT"
