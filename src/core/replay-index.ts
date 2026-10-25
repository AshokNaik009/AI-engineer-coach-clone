/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replay inverted index — pure core, no VS Code dependency.
 *
 * Maps a normalized absolute file path to every `FileChangeRef` pointer that
 * touched it, across all parsed sessions. Pointers come from the Claude
 * parser (`SessionRequest.fileChanges`); other harnesses only contribute
 * `editedFiles` entries, which are indexed too so they show up in Replay
 * lists with "diff not available for this harness".
 *
 * External-harness sessions are re-collected on every load (they bypass the
 * disk cache), so the index is built in memory from the live `ParseResult`
 * rather than persisted — it takes milliseconds for tens of thousands of
 * pointers.
 */

import * as path from 'path';
import type { FileChangeRef, Session } from './types';

export interface FileChangeHit {
  sessionId: string;
  requestIdx: number;
  /** Index into `request.fileChanges`; -1 when the hit comes from a
   *  harness without pointers (`editedFiles` only). */
  changeIdx: number;
  ts: number | null;
}

export type FileChangeIndex = Map<string, FileChangeHit[]>;

/** Case-insensitive filesystems (macOS default, Windows) need a folded key;
 *  the original spelling is kept on the pointer for display. */
const CASE_INSENSITIVE_FS = process.platform === 'darwin' || process.platform === 'win32';

/**
 * Resolve a tool-recorded path to an absolute, normalized index key.
 * Relative paths resolve against the session's workspace root when known.
 */
export function normalizeChangePath(filePath: string, workspaceRoot?: string): string {
  let abs = filePath;
  if (!path.isAbsolute(abs)) {
    abs = workspaceRoot ? path.join(workspaceRoot, abs) : abs;
  }
  abs = path.normalize(abs);
  if (abs.length > 1 && (abs.endsWith(path.sep) || abs.endsWith('/'))) abs = abs.slice(0, -1);
  return CASE_INSENSITIVE_FS ? abs.toLowerCase() : abs;
}

/** Build the path → hits index. Hits are sorted newest first per path. */
export function buildFileChangeIndex(sessions: Session[]): FileChangeIndex {
  const index: FileChangeIndex = new Map();
  const add = (key: string, hit: FileChangeHit): void => {
    const hits = index.get(key);
    if (hits) hits.push(hit);
    else index.set(key, [hit]);
  };

  for (const session of sessions) {
    for (let requestIdx = 0; requestIdx < session.requests.length; requestIdx++) {
      const request = session.requests[requestIdx];
      const changes = request.fileChanges;
      if (changes && changes.length > 0) {
        for (let changeIdx = 0; changeIdx < changes.length; changeIdx++) {
          add(normalizeChangePath(changes[changeIdx].path, session.workspaceRootPath), {
            sessionId: session.sessionId, requestIdx, changeIdx, ts: request.timestamp,
          });
        }
        continue;
      }
      // Pointer-less harnesses: one hit per edited file, no diff available.
      const seen = new Set<string>();
      for (const edited of request.editedFiles) {
        const key = normalizeChangePath(edited, session.workspaceRootPath);
        if (seen.has(key)) continue;
        seen.add(key);
        add(key, { sessionId: session.sessionId, requestIdx, changeIdx: -1, ts: request.timestamp });
      }
    }
  }

  for (const hits of index.values()) hits.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  return index;
}

export type SessionsById = Map<string, Session>;

export function sessionsById(sessions: Session[]): SessionsById {
  return new Map(sessions.map(s => [s.sessionId, s]));
}

/** Resolve a hit back to its pointer (null for pointer-less hits). */
export function resolveHit(byId: SessionsById, hit: FileChangeHit): { session: Session; ref: FileChangeRef | null } | null {
  const session = byId.get(hit.sessionId);
  const request = session?.requests[hit.requestIdx];
  if (!session || !request) return null;
  const ref = hit.changeIdx >= 0 ? request.fileChanges?.[hit.changeIdx] ?? null : null;
  return { session, ref };
}

export interface TopFileEntry {
  path: string;
  edits: number;
  sessions: number;
}

/** Most-edited files, for the Replay picker's default list. `path` is the
 *  original spelling of the most recent pointer. */
export function topEditedFiles(byId: SessionsById, index: FileChangeIndex, limit = 50): TopFileEntry[] {
  const out: TopFileEntry[] = [];
  for (const [key, hits] of index) {
    const sessionIds = new Set(hits.map(h => h.sessionId));
    const display = displayPathForKey(byId, key, hits) ?? key;
    out.push({ path: display, edits: hits.length, sessions: sessionIds.size });
  }
  out.sort((a, b) => b.edits - a.edits || a.path.localeCompare(b.path));
  return out.slice(0, limit);
}

/** Original (un-folded) absolute spelling of an index key, taken from the
 *  most recent hit that recorded it. */
export function displayPathForKey(byId: SessionsById, key: string, hits: FileChangeHit[]): string | null {
  for (const hit of hits) {
    const resolved = resolveHit(byId, hit);
    if (!resolved) continue;
    const root = resolved.session.workspaceRootPath;
    const candidates = resolved.ref ? [resolved.ref.path] : resolved.session.requests[hit.requestIdx].editedFiles;
    for (const raw of candidates) {
      if (normalizeChangePath(raw, root) !== key) continue;
      return path.isAbsolute(raw) || !root ? raw : path.join(root, raw);
    }
  }
  return null;
}
