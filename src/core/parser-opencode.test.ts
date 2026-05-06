/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tests for the OpenCode parser — verifies that assistant messages with
 * `tokens: {input:0, output:0}` (tool-only / cached continuation steps)
 * are recorded as data (zero tokens), not flagged as missing. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { parseOpenCodeSessions } from './parser-opencode';

function withStorage(
  rawSession: object,
  messages: object[],
  run: (storageDir: string) => void,
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-parser-test-'));
  const storageDir = path.join(root, 'storage');
  const sessId = (rawSession as { id: string }).id;
  fs.mkdirSync(path.join(storageDir, 'session', 'global'), { recursive: true });
  fs.writeFileSync(
    path.join(storageDir, 'session', 'global', `${sessId}.json`),
    JSON.stringify(rawSession),
    'utf-8',
  );
  fs.mkdirSync(path.join(storageDir, 'message', sessId), { recursive: true });
  for (const msg of messages) {
    const m = msg as { id: string };
    fs.writeFileSync(
      path.join(storageDir, 'message', sessId, `${m.id}.json`),
      JSON.stringify(msg),
      'utf-8',
    );
  }
  try { run(storageDir); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

describe('parseOpenCodeSessions', () => {
  it('records {input:0,output:0} assistants as zero-token data, not missing', () => {
    withStorage(
      { id: 'sess1', directory: '/Users/me/proj', time: { created: 1700000000000 } },
      [
        { id: 'm1', sessionID: 'sess1', role: 'user', time: { created: 1700000000000 }, summary: { title: 'hi' } },
        // First assistant: tool-only continuation step with zeroed tokens
        {
          id: 'm2', sessionID: 'sess1', role: 'assistant', parentID: 'm1',
          time: { created: 1700000001000, completed: 1700000002000 },
          modelID: 'claude-sonnet-4',
          tokens: { input: 0, output: 0 },
        },
        { id: 'm3', sessionID: 'sess1', role: 'user', time: { created: 1700000003000 }, summary: { title: 'go on' } },
        // Second assistant: real tokens
        {
          id: 'm4', sessionID: 'sess1', role: 'assistant', parentID: 'm3',
          time: { created: 1700000004000, completed: 1700000005000 },
          modelID: 'claude-sonnet-4',
          tokens: { input: 1000, output: 50 },
        },
      ],
      (storageDir) => {
        const sessions = parseOpenCodeSessions(storageDir);
        expect(sessions).toHaveLength(1);
        const reqs = sessions[0].requests;
        expect(reqs).toHaveLength(2);
        // The zero-token assistant should produce 0 tokens, NOT null/missing
        expect(reqs[0].promptTokens).toBe(0);
        expect(reqs[0].completionTokens).toBe(0);
        // Second assistant has real numbers
        expect(reqs[1].promptTokens).toBe(1000);
        expect(reqs[1].completionTokens).toBe(50);
      },
    );
  });

  it('marks a request as missing when the assistant message is absent entirely', () => {
    withStorage(
      { id: 'sess2', directory: '/Users/me/proj' },
      [
        { id: 'u1', sessionID: 'sess2', role: 'user', time: { created: 1700000000000 }, summary: { title: 'hi' } },
        // No assistant message at all
      ],
      (storageDir) => {
        const sessions = parseOpenCodeSessions(storageDir);
        expect(sessions).toHaveLength(1);
        expect(sessions[0].requests[0].promptTokens).toBeNull();
        expect(sessions[0].requests[0].completionTokens).toBeNull();
      },
    );
  });
});
