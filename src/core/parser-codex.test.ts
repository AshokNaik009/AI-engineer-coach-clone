/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tests for the Codex CLI parser — verifies that the final cumulative
 * `token_count` totals are exposed as Session.modelUsage so the analyzer
 * can fall back to session-level distribution for turns where per-request
 * deltas are missing (sub-tasks, aborts, cached responses). */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { parseCodexSessions } from './parser-codex';

function withCodexFile(lines: object[], run: (sessionsDir: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parser-test-'));
  const dayDir = path.join(root, 'sessions', '2025', '06', '15');
  fs.mkdirSync(dayDir, { recursive: true });
  const file = path.join(dayDir, 'rollout-2025-06-15-test.jsonl');
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n'), 'utf-8');
  try { run(path.join(root, 'sessions')); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

describe('parseCodexSessions', () => {
  it('exposes final cumulative token_count totals as Session.modelUsage', () => {
    withCodexFile([
      { type: 'session_meta', payload: { id: 'sess-codex-1', cwd: '/Users/me/proj' } },
      { type: 'turn_context', payload: { model: 'gpt-5.3-codex' } },
      { type: 'event_msg', timestamp: '2025-06-15T10:00:00Z', payload: { type: 'user_message', message: 'hi' } },
      { type: 'event_msg', timestamp: '2025-06-15T10:00:01Z', payload: { type: 'agent_message' } },
      { type: 'event_msg', timestamp: '2025-06-15T10:00:02Z',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, output_tokens: 100, cached_input_tokens: 200 } } } },
      { type: 'event_msg', timestamp: '2025-06-15T10:00:10Z', payload: { type: 'user_message', message: 'go on' } },
      // No token_count update for this turn — would have null per-request data
      { type: 'event_msg', timestamp: '2025-06-15T10:00:11Z', payload: { type: 'agent_message' } },
      // Final cumulative total covers BOTH turns
      { type: 'event_msg', timestamp: '2025-06-15T10:00:20Z',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 3000, output_tokens: 250, cached_input_tokens: 600 } } } },
    ], (sessionsDir) => {
      const sessions = parseCodexSessions(sessionsDir);
      expect(sessions).toHaveLength(1);
      const s = sessions[0];
      expect(s.modelUsage).toBeDefined();
      const u = s.modelUsage!['gpt-5.3-codex'];
      expect(u).toBeDefined();
      // uncached input = total_input - cached_input = 3000 - 600 = 2400
      expect(u.inputTokens).toBe(2400);
      expect(u.cacheReadTokens).toBe(600);
      expect(u.outputTokens).toBe(250);
    });
  });

  it('omits modelUsage when no token_count event ever fires', () => {
    withCodexFile([
      { type: 'session_meta', payload: { id: 'sess-codex-2', cwd: '/Users/me/proj' } },
      { type: 'turn_context', payload: { model: 'gpt-5.3-codex' } },
      { type: 'event_msg', timestamp: '2025-06-15T10:00:00Z', payload: { type: 'user_message', message: 'hi' } },
      { type: 'event_msg', timestamp: '2025-06-15T10:00:01Z', payload: { type: 'agent_message' } },
    ], (sessionsDir) => {
      const sessions = parseCodexSessions(sessionsDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].modelUsage).toBeUndefined();
    });
  });
});
