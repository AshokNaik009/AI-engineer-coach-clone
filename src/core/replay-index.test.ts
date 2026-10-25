/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { buildFileChangeIndex, normalizeChangePath, resolveHit, sessionsById, topEditedFiles } from './replay-index';
import { createRequest, createSession } from './parser-shared';
import type { FileChangeRef, Session } from './types';

const ROOT = path.resolve('/Users/me/proj');
const FOLD = (p: string) => (process.platform === 'darwin' || process.platform === 'win32' ? p.toLowerCase() : p);

function req(ts: number, fileChanges?: FileChangeRef[], editedFiles: string[] = []): ReturnType<typeof createRequest> {
  return createRequest({
    requestId: `r-${ts}`,
    timestamp: ts,
    messageText: `prompt ${ts}`,
    responseText: '',
    editedFiles: fileChanges ? fileChanges.map(c => c.path) : editedFiles,
    ...(fileChanges ? { fileChanges } : {}),
  });
}

function session(id: string, harness: string, requests: ReturnType<typeof createRequest>[], root?: string): Session {
  return createSession({
    sessionId: id, workspaceId: 'ws', workspaceName: 'proj', location: 'terminal', harness,
    creationDate: requests[0]?.timestamp ?? null, lastMessageDate: requests.at(-1)?.timestamp ?? null,
    requests, workspaceRootPath: root,
  });
}

describe('normalizeChangePath', () => {
  it('resolves relative paths against the workspace root and folds case on case-insensitive platforms', () => {
    expect(normalizeChangePath('src/A.ts', ROOT)).toBe(FOLD(path.join(ROOT, 'src/A.ts')));
    expect(normalizeChangePath(path.join(ROOT, 'src', 'A.ts'))).toBe(FOLD(path.join(ROOT, 'src/A.ts')));
  });
  it('strips a trailing separator', () => {
    expect(normalizeChangePath(ROOT + path.sep)).toBe(FOLD(ROOT));
  });
});

describe('buildFileChangeIndex', () => {
  const a = path.join(ROOT, 'src', 'a.ts');
  const claude = session('claude-1', 'Claude', [
    req(1000, [{ path: a, tool: 'Edit', lineNo: 2 }]),
    req(3000, [{ path: 'src/a.ts', tool: 'Write', lineNo: 9 }, { path: 'src/b.ts', tool: 'MultiEdit', lineNo: 9, editCount: 2 }]),
  ], ROOT);
  const codex = session('codex-1', 'Codex', [req(2000, undefined, [a, a])], ROOT);

  it('groups pointers by normalized path, newest first, and marks pointer-less hits with changeIdx -1', () => {
    const index = buildFileChangeIndex([claude, codex]);
    const hitsA = index.get(normalizeChangePath(a))!;
    expect(hitsA.map(h => [h.sessionId, h.requestIdx, h.changeIdx, h.ts])).toEqual([
      ['claude-1', 1, 0, 3000],
      ['codex-1', 0, -1, 2000],
      ['claude-1', 0, 0, 1000],
    ]);
    expect(index.get(normalizeChangePath(path.join(ROOT, 'src', 'b.ts')))).toHaveLength(1);
  });

  it('resolveHit returns the pointer for Claude hits and null ref for pointer-less hits', () => {
    const index = buildFileChangeIndex([claude, codex]);
    const byId = sessionsById([claude, codex]);
    const [newest, codexHit] = index.get(normalizeChangePath(a))!;
    expect(resolveHit(byId, newest)?.ref).toEqual({ path: 'src/a.ts', tool: 'Write', lineNo: 9 });
    expect(resolveHit(byId, codexHit)?.ref).toBeNull();
    expect(resolveHit(byId, { sessionId: 'nope', requestIdx: 0, changeIdx: 0, ts: null })).toBeNull();
  });

  it('topEditedFiles ranks by edit count and shows the original spelling', () => {
    const index = buildFileChangeIndex([claude, codex]);
    const top = topEditedFiles(sessionsById([claude, codex]), index);
    expect(top[0]).toEqual({ path: path.join(ROOT, 'src/a.ts'), edits: 3, sessions: 2 });
    expect(top[1]).toEqual({ path: path.join(ROOT, 'src/b.ts'), edits: 1, sessions: 1 });
  });
});
