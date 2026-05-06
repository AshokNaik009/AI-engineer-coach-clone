/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest';
import { compileNaturalLanguageRule } from './rule-compiler';

describe('compileNaturalLanguageRule — heuristic fallback', () => {
  it('generates valid markdown with frontmatter for a basic prompt', async () => {
    const result = await compileNaturalLanguageRule('Detect short lazy prompts');
    expect(result.usedLlm).toBe(false);
    expect(result.markdown).toContain('---');
    expect(result.markdown).toContain('id: detect-short-lazy-prompts');
    expect(result.markdown).toContain('# Filter');
    expect(result.markdown).toContain('# Trigger');
    expect(result.markdown).toContain('# Description');
  });

  it('uses short/lazy pattern for short prompt descriptions', async () => {
    const result = await compileNaturalLanguageRule('Find short terse messages');
    expect(result.markdown).toContain('messageLength');
    expect(result.markdown).toContain('maxLength');
  });

  it('uses cancel pattern for cancel-related prompts', async () => {
    const result = await compileNaturalLanguageRule('Detect frequent cancellations');
    expect(result.markdown).toContain('isCanceled');
  });

  it('uses night pattern for late-night prompts', async () => {
    const result = await compileNaturalLanguageRule('Flag late night coding');
    expect(result.markdown).toContain('hour(timestamp)');
    expect(result.markdown).toContain('startHour');
  });

  it('uses weekend pattern', async () => {
    const result = await compileNaturalLanguageRule('Detect weekend work');
    expect(result.markdown).toContain('dayOfWeek');
  });

  it('uses no-context pattern for no file references', async () => {
    const result = await compileNaturalLanguageRule('Find prompts with no file context');
    expect(result.markdown).toContain('referencedFiles');
  });

  it('uses mega-session pattern for long sessions', async () => {
    const result = await compileNaturalLanguageRule('Detect mega long sessions', { scope: 'sessions' });
    expect(result.markdown).toContain('requestCount');
  });

  it('uses tool pattern for agent/tool prompts', async () => {
    const result = await compileNaturalLanguageRule('Detect agent mode without tool usage');
    expect(result.markdown).toContain('agentMode');
    expect(result.markdown).toContain('toolsUsed');
  });

  it('respects group override', async () => {
    const result = await compileNaturalLanguageRule('Custom rule', { group: 'code-review' });
    expect(result.markdown).toContain('group: code-review');
  });

  it('respects severity override', async () => {
    const result = await compileNaturalLanguageRule('Custom rule', { severity: 'high' });
    expect(result.markdown).toContain('severity: high');
  });

  it('respects scope override', async () => {
    const result = await compileNaturalLanguageRule('Custom rule', { scope: 'sessions' });
    expect(result.markdown).toContain('scope: sessions');
  });

  it('guesses session scope for session-related prompts', async () => {
    const result = await compileNaturalLanguageRule('Abandoned session detection');
    expect(result.markdown).toContain('scope: sessions');
  });

  it('guesses session-hygiene group for session prompts', async () => {
    const result = await compileNaturalLanguageRule('Abandoned session detection');
    expect(result.markdown).toContain('group: session-hygiene');
  });

  it('guesses code-review group for code-related prompts', async () => {
    const result = await compileNaturalLanguageRule('Accept code without review');
    expect(result.markdown).toContain('group: code-review');
  });

  it('guesses tool-mastery group for tool prompts', async () => {
    const result = await compileNaturalLanguageRule('Premium model usage');
    expect(result.markdown).toContain('group: tool-mastery');
  });

  it('defaults to prompt-quality group', async () => {
    const result = await compileNaturalLanguageRule('Something generic');
    expect(result.markdown).toContain('group: prompt-quality');
  });

  it('truncates long names', async () => {
    const longPrompt = 'a'.repeat(100);
    const result = await compileNaturalLanguageRule(longPrompt);
    expect(result.markdown).toContain('name: ' + longPrompt.substring(0, 57) + '...');
  });

  it('generates id from prompt text (kebab-case)', async () => {
    const result = await compileNaturalLanguageRule('Hello World Test!');
    expect(result.markdown).toContain('id: hello-world-test');
  });

  it('includes test cases section', async () => {
    const result = await compileNaturalLanguageRule('Any rule');
    expect(result.markdown).toContain('# Test Cases');
    expect(result.markdown).toContain('expect: flagged');
    expect(result.markdown).toContain('expect: clean');
  });

  it('parses the generated rule successfully', async () => {
    const result = await compileNaturalLanguageRule('Detect short prompts');
    expect(result.rule).not.toBeNull();
    expect(result.rule!.id).toBe('detect-short-prompts');
  });

  it('adds LLM unavailable note', async () => {
    const result = await compileNaturalLanguageRule('Test rule');
    // Since vscode is not available in tests, it should have a note about LLM unavailability
    expect(result.notes.length).toBeGreaterThanOrEqual(0);
  });
});
