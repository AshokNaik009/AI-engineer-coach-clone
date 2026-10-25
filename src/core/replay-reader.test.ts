/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { countDiffLines, extractEdits, readFileChange } from './replay-reader';

let dir: string;
let file: string;

const lines = [
  { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'edit it' }] } },
  { type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'tu-edit', name: 'Edit', input: { file_path: '/p/a.ts', old_string: 'a\nb', new_string: 'a\nc\nd', replace_all: true } },
    { type: 'tool_use', id: 'tu-write', name: 'Write', input: { file_path: '/p/b.ts', content: 'x\ny' } },
  ] } },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-edit', content: 'ok' }] } },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-write', is_error: true, content: 'denied' }] } },
  { type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'tu-multi', name: 'MultiEdit', input: { file_path: '/p/c.ts', edits: [
      { old_string: 'one', new_string: 'uno' }, { old_string: 'two', new_string: 'dos\ntres' },
    ] } },
  ] } },
  'this line is not json',
  { type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'tu-big', name: 'Write', input: { file_path: '/p/big.ts', content: 'z'.repeat(5000) } },
  ] } },
];

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-reader-'));
  file = path.join(dir, 'sess.jsonl');
  fs.writeFileSync(file, lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
});

afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('readFileChange', () => {
  it('reads an Edit by tool_use id and correlates its tool_result', async () => {
    const res = await readFileChange(file, { lineNo: 1, tool: 'Edit', toolUseId: 'tu-edit' });
    expect(res).toEqual({
      tool: 'Edit', path: '/p/a.ts',
      edits: [{ oldString: 'a\nb', newString: 'a\nc\nd', replaceAll: true }],
      toolResultOk: true,
    });
  });

  it('narrows by path when no id is known and reports failed tool_results', async () => {
    const res = await readFileChange(file, { lineNo: 1, tool: 'Write', path: '/p/b.ts' });
    expect(res).toEqual({ tool: 'Write', path: '/p/b.ts', edits: [{ oldString: '', newString: 'x\ny' }], toolResultOk: false });
  });

  it('expands MultiEdit into one edit per entry and tolerates a missing tool_result', async () => {
    const res = await readFileChange(file, { lineNo: 4, tool: 'MultiEdit', toolUseId: 'tu-multi' });
    expect(res).toEqual({
      tool: 'MultiEdit', path: '/p/c.ts',
      edits: [{ oldString: 'one', newString: 'uno' }, { oldString: 'two', newString: 'dos\ntres' }],
    });
    expect(countDiffLines(res as Parameters<typeof countDiffLines>[0])).toEqual({ added: 3, removed: 2 });
  });

  it('returns stale-index when the line does not hold the expected tool_use', async () => {
    expect(await readFileChange(file, { lineNo: 0, tool: 'Edit' })).toEqual({ error: 'stale-index' });
    expect(await readFileChange(file, { lineNo: 1, tool: 'Edit', toolUseId: 'other' })).toEqual({ error: 'stale-index' });
    expect(await readFileChange(file, { lineNo: 5, tool: 'Edit' })).toEqual({ error: 'stale-index' });
    expect(await readFileChange(file, { lineNo: 99, tool: 'Edit' })).toEqual({ error: 'stale-index' });
  });

  it('truncates oversized payloads instead of shipping them', async () => {
    const res = await readFileChange(file, { lineNo: 6, tool: 'Write', toolUseId: 'tu-big' }, 1024);
    expect(res).toMatchObject({ tool: 'Write', path: '/p/big.ts', edits: [], truncated: true });
    expect((res as { bytes: number }).bytes).toBeGreaterThan(5000);
  });

  it('refuses paths outside trusted roots and bad line numbers', async () => {
    expect(await readFileChange('/etc/passwd', { lineNo: 0, tool: 'Edit' })).toHaveProperty('error');
    expect(await readFileChange(file, { lineNo: -1, tool: 'Edit' })).toEqual({ error: 'Invalid line number.' });
  });
});

describe('extractEdits', () => {
  it('accepts legacy old_str/new_str', () => {
    expect(extractEdits('Edit', { old_str: 'a', new_str: 'b' })).toEqual([{ oldString: 'a', newString: 'b' }]);
  });
  it('returns null for malformed input', () => {
    expect(extractEdits('Edit', { new_string: 'b' })).toBeNull();
    expect(extractEdits('Write', {})).toBeNull();
    expect(extractEdits('MultiEdit', { edits: 'nope' })).toBeNull();
  });
});
