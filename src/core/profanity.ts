/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Profanity detection backed by the `leo-profanity` dictionary, so the
 * plaintext wordlist lives in an external package and is not committed to
 * this repository.
 *
 * We strip fenced code blocks and inline backticks before checking so that
 * strings inside code snippets don't produce false positives.
 */

import leoProfanity from 'leo-profanity';

/** Strip code blocks and inline-backtick content so we don't flag code strings. */
function stripCode(text: string): string {
  return text.replaceAll(/```[\s\S]*?```/g, '').replaceAll(/`[^`]+`/g, '');
}

/** Returns true if the (code-stripped) text contains any flagged word. */
export function containsProfanity(text: string): boolean {
  if (!text) return false;
  return leoProfanity.check(stripCode(text));
}

/**
 * Extract all flagged words found in the text (deduped, order-preserving,
 * lowercased). Matches inside fenced or inline code are ignored.
 */
export function extractProfaneWords(text: string): string[] {
  if (!text) return [];
  const cleaned = stripCode(text);
  const found = leoProfanity.badWordsUsed(cleaned);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    const w = raw.toLowerCase();
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}
