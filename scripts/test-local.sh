#!/usr/bin/env bash
# --------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Resolve the `code-insiders` CLI (macOS may not have it on PATH)
if command -v code-insiders &>/dev/null; then
  CODE=code-insiders
elif [[ -x "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code" ]]; then
  CODE="/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"
else
  echo "❌ Could not find VS Code Insiders ('code-insiders' CLI). Install it via: VS Code Insiders → Cmd+Shift+P → 'Shell Command: Install code-insiders command'"
  exit 1
fi

# Package the extension (builds + swaps README + creates .vsix)
echo "📦 Packaging extension..."
npm run package

# Find the generated .vsix file (latest by modification time)
shopt -s nullglob
vsix_files=(*.vsix)
shopt -u nullglob
if [[ ${#vsix_files[@]} -eq 0 ]]; then
  echo "❌ No .vsix file found after packaging"
  exit 1
fi
VSIX=$(ls -t "${vsix_files[@]}" | head -n1)

echo "📥 Installing $VSIX..."
"$CODE" --install-extension "$VSIX" --force

if [[ "${SKIP_LAUNCH:-}" == "1" ]]; then
  echo "✅ Extension installed (launch skipped)"
else
  echo "🚀 Launching VS Code in current directory..."
  "$CODE" .
fi
