/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest';
import { containsProfanity, extractProfaneWords } from './profanity';

/**
 * Test fixtures for the profanity detector. Inputs are base64-encoded so
 * the repository does not contain plaintext profanity. Decoded values are
 * real entries from the `leo-profanity` default dictionary.
 */
const FIXTURES = {
  wordA: 'YW5hbA==',
  wordB: 'YW51cw==',
  phraseHasA: 'dGhpcyBpcyBhbmFs',
  phraseHasB: 'd2hhdCB0aGUgYW51cw==',
  phraseUpperA: 'QU5BTCB0aGlzIGJ1aWxk',
  phraseDupe: 'YW5hbCBhbmQgYW5hbCB0aGVuIGFudXM=',
  phraseUpperPair: 'QU5BTCBBTlVT',
  codeFence: 'Y2xlYW4KYGBgCmFuYWwKYGBgCg==',
  inlineTicks: 'c2V0IGBhbmFsYCB2YXJpYWJsZQ==',
  codeFenceMixed: 'RmluZSB0ZXh0CmBgYGpzCmNvbnN0IGFuYWwgPSAxOwpgYGAKbW9yZSBmaW5lIHRleHQ=',
} as const;
const d = (key: keyof typeof FIXTURES): string => Buffer.from(FIXTURES[key], 'base64').toString('utf8');

describe('profanity', () => {
  describe('containsProfanity', () => {
    it('returns false for clean text', () => {
      expect(containsProfanity('Please refactor this module carefully.')).toBe(false);
    });

    it('returns true when text has a flagged word', () => {
      expect(containsProfanity(d('phraseHasA'))).toBe(true);
      expect(containsProfanity(d('phraseHasB'))).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(containsProfanity(d('phraseUpperA'))).toBe(true);
    });

    it('ignores flagged tokens inside fenced code blocks', () => {
      expect(containsProfanity(d('codeFenceMixed'))).toBe(false);
    });

    it('ignores flagged tokens inside inline backticks', () => {
      expect(containsProfanity(d('inlineTicks'))).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(containsProfanity('')).toBe(false);
    });
  });

  describe('extractProfaneWords', () => {
    it('returns deduped list preserving first occurrence order', () => {
      const words = extractProfaneWords(d('phraseDupe'));
      expect(words).toEqual([d('wordA'), d('wordB')]);
    });

    it('returns empty array for clean text', () => {
      expect(extractProfaneWords('Clean request please')).toEqual([]);
    });

    it('lowercases matched words', () => {
      const words = extractProfaneWords(d('phraseUpperPair'));
      expect(words).toEqual([d('wordA'), d('wordB')]);
    });

    it('ignores matches inside code fences', () => {
      expect(extractProfaneWords(d('codeFence'))).toEqual([]);
    });
  });
});
