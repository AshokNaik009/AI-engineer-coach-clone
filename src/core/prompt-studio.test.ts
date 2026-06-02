/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeAll, describe, it, expect } from 'vitest';
import { registerAllBuiltinRules } from './rule-loader';
import { invalidateDetectorRegistry } from './detector-registry';
import { getAllRules } from './rule-engine';
import {
  buildSyntheticRequest,
  buildSyntheticSession,
  diagnosePrompt,
  assembleProfile,
  estimateTokens,
  buildCost,
} from './prompt-studio';
import type { Session, StudioInput } from './types';

beforeAll(() => {
  registerAllBuiltinRules();
  invalidateDetectorRegistry();
});

function diagnoseIds(input: StudioInput): string[] {
  return diagnosePrompt(input, getAllRules()).map(i => i.ruleId);
}

describe('synthetic-session adapter', () => {
  it('defaults every field a content rule reads', () => {
    const r = buildSyntheticRequest({ text: 'hello' });
    expect(r.messageText).toBe('hello');
    expect(r.messageLength).toBe(5);
    expect(r.agentMode).toBe('chat');
    expect(r.modelId).toBe('');
    expect(r.referencedFiles).toEqual([]);
    expect(r.editedFiles).toEqual([]);
    expect(r.toolsUsed).toEqual([]);
    expect(r.aiCode).toEqual([]);
  });

  it('materializes referenced/edited file placeholders from counts', () => {
    const r = buildSyntheticRequest({ text: 'x', referencedFileCount: 3, editedFileCount: 2 });
    expect(r.referencedFiles).toHaveLength(3);
    expect(r.editedFiles).toHaveLength(2);
  });

  it('wraps a request as a one-request session, shapeable', () => {
    const r = buildSyntheticRequest({ text: 'x' });
    const s = buildSyntheticSession(r, { requestCount: 3 });
    expect(s.requests).toEqual([r]);
    expect(s.requestCount).toBe(3);
    expect(s.harness).toBe('Studio');
  });
});

describe('diagnosePrompt — curated single-prompt subset', () => {
  it('flags a too-short prompt (lazy-prompting) at n=1', () => {
    // Without the n=1 threshold override this could never fire (minSample:10).
    expect(diagnoseIds({ text: 'fix bug' })).toContain('lazy-prompting');
  });

  it('flags an all-caps prompt (caps-lock)', () => {
    expect(diagnoseIds({ text: 'WHY DOES THIS NOT WORK AT ALL' })).toContain('caps-lock');
  });

  it('flags excessive file context once the file count clears the studio threshold', () => {
    const ids = diagnoseIds({
      text: 'Implement the new billing feature across the affected modules.',
      referencedFileCount: 15,
    });
    expect(ids).toContain('excessive-file-context');
  });

  it('flags missing file context for code work with no files attached', () => {
    expect(diagnoseIds({ text: 'fix the failing login test', referencedFileCount: 0 })).toContain('no-file-context');
  });

  it('does NOT raise context-engineering-gaps on the single prompt (it is a profile signal)', () => {
    expect(diagnoseIds({ text: 'fix bug' })).not.toContain('context-engineering-gaps');
  });

  it('returns no issues for a well-structured, constrained prompt with context', () => {
    const ids = diagnoseIds({
      text: [
        'Refactor the auth module to use JWT.',
        '- Add refresh token rotation',
        '- Do not use class components',
        '- Must include unit tests',
        'Ensure backwards compatibility.',
      ].join('\n'),
      agentMode: 'agent',
      referencedFileCount: 3,
    });
    expect(ids).toEqual([]);
  });
});

describe('assembleProfile', () => {
  function studioReq(text: string) {
    return buildSyntheticRequest({ text });
  }
  function makeSession(texts: string[]): Session {
    const reqs = texts.map(studioReq);
    return buildSyntheticSession(reqs[0], { requestCount: reqs.length, requests: reqs });
  }

  it('computes intent, sample size, and a pattern list from history', () => {
    const sessions = [makeSession(['fix bug', 'add the new feature with tests'])];
    const profile = assembleProfile(sessions, { text: 'refactor the parser' }, getAllRules());
    expect(['Planning', 'Implementation', 'Debugging', 'Review', 'Exploration']).toContain(profile.intent);
    expect(profile.sampleSize).toBe(2);
    expect(Array.isArray(profile.topPatterns)).toBe(true);
    // Below the history threshold, context gaps are withheld.
    expect(profile.contextGaps).toEqual([]);
  });

  it('handles empty history gracefully', () => {
    const profile = assembleProfile([], { text: 'fix bug' }, getAllRules());
    expect(profile.sampleSize).toBe(0);
    expect(profile.topPatterns).toEqual([]);
  });
});

describe('cost preview', () => {
  it('estimates tokens at ~4 chars/token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('')).toBe(0);
  });

  it('omits credits when token reporting is disabled', () => {
    const cost = buildCost('hello world', undefined, false);
    expect(cost.credits).toBeNull();
    expect(cost.reportingEnabled).toBe(false);
    expect(cost.tokens).toBeGreaterThan(0);
  });

  it('includes credits + a default model when reporting is enabled', () => {
    const cost = buildCost('hello world', undefined, true);
    expect(cost.reportingEnabled).toBe(true);
    expect(typeof cost.credits).toBe('number');
    expect(cost.model).toBe('claude-opus-4-8');
  });
});
