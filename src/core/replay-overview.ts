/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replay overview — pure core, no VS Code dependency.
 *
 * Aggregates the inverted index into the landing-page stats: every file AI
 * touched (scoped to a workspace root when given), classified as
 * created / modified / deleted, with added/removed line counts computed from
 * the actual edit payloads. Counting lines means reading every pointer once,
 * so the work is bounded (`maxReads`) and results are memoized by the caller.
 */

import * as fs from 'fs';
import * as path from 'path';
import { diffLines } from 'diff';
import { findClaudeSessionFile } from './claude-resume';
import { type FileChangeHit, type FileChangeIndex, type SessionsById, displayPathForKey, resolveHit } from './replay-index';
import { readFileChange } from './replay-reader';
import type { FileChangeEdit, ReplayOverview, ReplayOverviewFile } from './types/replay-types';

export type { ReplayOverview, ReplayOverviewFile };

export interface OverviewOptions {
  /** Only files under this root (normalized compare). Omit for everything. */
  workspaceRoot?: string;
  /** Only hits whose session id is in this set (date/harness pre-filter). */
  sessionIds?: Set<string>;
  /** Cap on lazy diff reads across the whole overview. */
  maxReads?: number;
  maxDiffBytes?: number;
}

const DEFAULT_MAX_READS = 4_000;

export function countEditLines(edits: FileChangeEdit[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const e of edits) {
    for (const part of diffLines(e.oldString, e.newString)) {
      const n = part.count ?? part.value.split('\n').length;
      if (part.added) added += n;
      else if (part.removed) removed += n;
    }
  }
  return { added, removed };
}

function isUnder(file: string, root: string): boolean {
  const rel = path.relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export async function buildReplayOverview(
  byId: SessionsById,
  index: FileChangeIndex,
  opts: OverviewOptions = {},
): Promise<ReplayOverview> {
  const maxReads = opts.maxReads ?? DEFAULT_MAX_READS;
  const root = opts.workspaceRoot ? path.resolve(opts.workspaceRoot) : undefined;
  const files: ReplayOverviewFile[] = [];
  const allSessions = new Set<string>();
  let reads = 0;
  let skippedReads = 0;
  const sessionFileCache = new Map<string, string | null>();

  for (const [key, allHits] of index) {
    const hits = opts.sessionIds ? allHits.filter(h => opts.sessionIds!.has(h.sessionId)) : allHits;
    if (hits.length === 0) continue;
    const display = displayPathForKey(byId, key, hits) ?? key;
    if (root && !isUnder(display, root)) continue;

    const entry: ReplayOverviewFile = {
      path: display,
      relPath: root ? path.relative(root, display).replaceAll('\\', '/') : display,
      kind: 'modified',
      edits: hits.length,
      sessions: new Set(hits.map(h => h.sessionId)).size,
      added: 0,
      removed: 0,
      partial: false,
      lastTs: hits[0]?.ts ?? null,
      harnesses: [],
    };
    const harnesses = new Set<string>();
    let sawWrite = false;
    let sawEdit = false;

    for (const hit of hits) {
      const resolved = resolveHit(byId, hit);
      if (!resolved) continue;
      harnesses.add(resolved.session.harness);
      allSessions.add(hit.sessionId);
      const { ref } = resolved;
      if (!ref) { entry.partial = true; continue; }
      if (ref.tool === 'Write') sawWrite = true; else sawEdit = true;
      if (reads >= maxReads) { skippedReads++; entry.partial = true; continue; }
      let sessionFile = ref.sessionFile;
      if (!sessionFile) {
        if (!sessionFileCache.has(hit.sessionId)) sessionFileCache.set(hit.sessionId, findClaudeSessionFile(hit.sessionId));
        sessionFile = sessionFileCache.get(hit.sessionId) ?? undefined;
      }
      if (!sessionFile) { entry.partial = true; continue; }
      reads++;
      const res = await readFileChange(sessionFile, { lineNo: ref.lineNo, tool: ref.tool, toolUseId: ref.toolUseId, path: ref.path }, opts.maxDiffBytes);
      if ('error' in res || res.truncated) { entry.partial = true; continue; }
      const { added, removed } = countEditLines(res.edits);
      entry.added += added;
      entry.removed += removed;
    }

    entry.harnesses = [...harnesses].sort();
    // Oldest pointer is a Write and nothing else came before → created by AI.
    const oldest = hits[hits.length - 1];
    const oldestRef = oldest ? resolveHit(byId, oldest)?.ref : null;
    if (!fs.existsSync(display)) entry.kind = 'deleted';
    else if (sawWrite && oldestRef?.tool === 'Write') entry.kind = 'created';
    else entry.kind = sawEdit || !sawWrite ? 'modified' : 'created';
    files.push(entry);
  }

  files.sort((a, b) => (b.added + b.removed) - (a.added + a.removed) || b.edits - a.edits || a.relPath.localeCompare(b.relPath));

  const totals = files.reduce((t, f) => {
    t.files++;
    t[f.kind]++;
    t.added += f.added;
    t.removed += f.removed;
    t.edits += f.edits;
    return t;
  }, { files: 0, created: 0, modified: 0, deleted: 0, added: 0, removed: 0, edits: 0, sessions: 0 });
  totals.sessions = allSessions.size;

  return { workspaceRoot: root, files, totals, skippedReads };
}

/** Hits grouped by session for the session view's quick stats. */
export function hitsBySession(index: FileChangeIndex): Map<string, FileChangeHit[]> {
  const out = new Map<string, FileChangeHit[]>();
  for (const hits of index.values()) for (const h of hits) {
    const list = out.get(h.sessionId);
    if (list) list.push(h); else out.set(h.sessionId, [h]);
  }
  return out;
}
