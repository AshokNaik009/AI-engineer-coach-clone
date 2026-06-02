/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { describe, it, expect } from 'vitest';
import { improvePromptViaClaude, type ClaudeRunner } from './claude-cli';
import type { ClaudeImproveInput } from './types';

const baseInput: ClaudeImproveInput = {
  text: 'fix the bug',
  issues: [{
    ruleId: 'lazy-prompting',
    ruleName: 'Lazy Prompting',
    severity: 'medium',
    group: 'prompt-quality',
    suggestion: 'Provide more context: intent, constraints, expected output.',
  }],
  profile: { intent: 'Debugging', topPatterns: [], contextGaps: [], sampleSize: 0 },
};

/** Pass cwd so the function skips real temp-dir creation/cleanup. */
const opts = (runner: ClaudeRunner) => ({ runner, cwd: os.tmpdir() });

function envelope(inner: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify(inner), ...extra });
}

describe('improvePromptViaClaude — happy path', () => {
  it('parses the JSON envelope and the inner coach JSON', async () => {
    const inner = { advice: ['be specific'], improvedPrompt: 'Task: fix the bug\n...', whatChanged: ['added context'] };
    const runner: ClaudeRunner = () => Promise.resolve({
      stdout: envelope(inner, { total_cost_usd: 0.02, usage: { input_tokens: 100, output_tokens: 50 } }),
      code: 0,
    });

    const res = await improvePromptViaClaude(baseInput, opts(runner));
    expect(res.source).toBe('claude');
    expect(res.improvedPrompt).toBe(inner.improvedPrompt);
    expect(res.advice).toEqual(['be specific']);
    expect(res.whatChanged).toEqual(['added context']);
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 50, costUsd: 0.02 });
  });

  it('tolerates leading logs and markdown fences around the JSON', async () => {
    const inner = { advice: [], improvedPrompt: 'Improved.', whatChanged: [] };
    const runner: ClaudeRunner = () => Promise.resolve({
      stdout: `some log line\n\`\`\`json\n${envelope(inner)}\n\`\`\`\n`,
      code: 0,
    });
    const res = await improvePromptViaClaude(baseInput, opts(runner));
    expect(res.source).toBe('claude');
    expect(res.improvedPrompt).toBe('Improved.');
  });

  it('sandboxes the call: uses haiku, tools disabled, prompt piped via stdin', async () => {
    let captured: { stdin: string; args: string[] } | undefined;
    const inner = { advice: [], improvedPrompt: 'x', whatChanged: [] };
    const runner: ClaudeRunner = (stdin, args) => {
      captured = { stdin, args };
      return Promise.resolve({ stdout: envelope(inner), code: 0 });
    };
    await improvePromptViaClaude(baseInput, opts(runner));
    expect(captured).toBeDefined();
    expect(captured!.args).toContain('-p');
    expect(captured!.args).toContain('--output-format');
    // model is haiku, behind the scenes
    expect(captured!.args[captured!.args.indexOf('--model') + 1]).toBe('haiku');
    // tools disabled (empty allowedTools value)
    expect(captured!.args[captured!.args.indexOf('--allowedTools') + 1]).toBe('');
    expect(captured!.stdin).toContain('fix the bug');
  });

  it('honors an explicit model override', async () => {
    let captured: string[] | undefined;
    const inner = { advice: [], improvedPrompt: 'x', whatChanged: [] };
    const runner: ClaudeRunner = (_stdin, args) => {
      captured = args;
      return Promise.resolve({ stdout: envelope(inner), code: 0 });
    };
    await improvePromptViaClaude(baseInput, { runner, cwd: os.tmpdir(), model: 'sonnet' });
    expect(captured![captured!.indexOf('--model') + 1]).toBe('sonnet');
  });
});

describe('improvePromptViaClaude — graceful fallback', () => {
  it('falls back when the binary is missing (ENOENT)', async () => {
    const runner: ClaudeRunner = () => {
      const err = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      return Promise.reject(err);
    };
    const res = await improvePromptViaClaude(baseInput, opts(runner));
    expect(res.source).toBe('fallback');
    expect(res.error).toMatch(/not found|claude/i);
    expect(res.improvedPrompt.length).toBeGreaterThan(0);
    // Fallback advice is drawn from the diagnosed issues.
    expect(res.advice).toEqual([baseInput.issues[0].suggestion]);
  });

  it('falls back on unparseable output', async () => {
    const runner: ClaudeRunner = () => Promise.resolve({ stdout: 'not json at all', code: 0 });
    const res = await improvePromptViaClaude(baseInput, opts(runner));
    expect(res.source).toBe('fallback');
  });

  it('falls back when the inner JSON lacks an improvedPrompt', async () => {
    const runner: ClaudeRunner = () => Promise.resolve({ stdout: envelope({ advice: ['hi'] }), code: 0 });
    const res = await improvePromptViaClaude(baseInput, opts(runner));
    expect(res.source).toBe('fallback');
  });

  it('falls back on timeout', async () => {
    const runner: ClaudeRunner = () => Promise.reject(new Error('claude timed out after 100ms'));
    const res = await improvePromptViaClaude(baseInput, opts(runner));
    expect(res.source).toBe('fallback');
    expect(res.error).toMatch(/timed out/);
  });

  it('falls back to a generic tip when there are no diagnosed issues', async () => {
    const runner: ClaudeRunner = () => Promise.reject(new Error('boom'));
    const res = await improvePromptViaClaude({ ...baseInput, issues: [] }, opts(runner));
    expect(res.source).toBe('fallback');
    expect(res.advice.length).toBeGreaterThan(0);
  });
});
