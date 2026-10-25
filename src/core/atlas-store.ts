/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Atlas map storage — pure core, no VS Code dependency (spec §4.3).
 *
 * Layout under the extension's globalStorage:
 *
 *   <root>/atlas/<workspaceHash>/index.json            AtlasMapMeta[] newest first
 *   <root>/atlas/<workspaceHash>/<mapId>/map.html       fresh maps (+ Archify receipts)
 *   <root>/atlas/<workspaceHash>/<baseId>/map-<id>.html refinements / overlays
 *                                                       (must share the base run's cwd
 *                                                        so `--resume` finds the session)
 *
 * Nothing here touches the repository. Export is an explicit, byte-identical
 * copy to a user-chosen path.
 */

import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { AtlasMapMeta, AtlasStaleness } from './types/atlas-types';

export function workspaceHash(workspaceRoot: string): string {
  return createHash('sha1').update(path.resolve(workspaceRoot)).digest('hex').slice(0, 16);
}

export class AtlasStore {
  readonly dir: string;
  private readonly indexPath: string;

  constructor(storageRoot: string, workspaceRoot: string) {
    this.dir = path.join(storageRoot, 'atlas', workspaceHash(workspaceRoot));
    this.indexPath = path.join(this.dir, 'index.json');
  }

  /** Run directory for a fresh map (also the cwd its Claude session is bound to). */
  runDir(mapId: string): string {
    return path.join(this.dir, mapId);
  }

  list(): AtlasMapMeta[] {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
      if (!Array.isArray(raw)) return [];
      return raw.filter(isMapMeta).sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  get(mapId: string): AtlasMapMeta | undefined {
    return this.list().find(m => m.id === mapId);
  }

  /** Insert newest-first and prune the oldest beyond `maxMaps` (deleting their files). */
  insert(meta: AtlasMapMeta, maxMaps: number): AtlasMapMeta[] {
    const maps = this.list().filter(m => m.id !== meta.id);
    maps.unshift(meta);
    const keep = Math.max(1, maxMaps);
    const pruned = maps.splice(keep);
    for (const old of pruned) this.removeFiles(old, maps);
    this.write(maps);
    return maps;
  }

  delete(mapId: string): boolean {
    const maps = this.list();
    const target = maps.find(m => m.id === mapId);
    if (!target) return false;
    const rest = maps.filter(m => m.id !== mapId);
    this.removeFiles(target, rest);
    this.write(rest);
    return true;
  }

  /** Byte-identical copy of the map HTML to `destination` (spec §4.3 Export). */
  exportTo(mapId: string, destination: string): void {
    const meta = this.get(mapId);
    if (!meta) throw new Error('Map not found.');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(meta.htmlPath, destination);
  }

  private write(maps: AtlasMapMeta[]): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.indexPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(maps, null, 2), 'utf-8');
    fs.renameSync(tmp, this.indexPath);
  }

  /** Remove a map's HTML (+ Archify sidecars sharing its stem). The run dir is
   *  removed only when no surviving map still lives in it. */
  private removeFiles(meta: AtlasMapMeta, survivors: AtlasMapMeta[]): void {
    const dir = path.dirname(meta.htmlPath);
    if (!isInside(dir, this.dir)) return; // never delete outside our own storage
    const stem = path.basename(meta.htmlPath, '.html');
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (entry === path.basename(meta.htmlPath) || entry.startsWith(`${stem}.`)) {
          try { fs.unlinkSync(path.join(dir, entry)); } catch { /* best effort */ }
        }
      }
    } catch { /* dir gone */ }
    const stillUsed = survivors.some(m => path.dirname(m.htmlPath) === dir);
    if (!stillUsed) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isMapMeta(value: unknown): value is AtlasMapMeta {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.htmlPath === 'string' && typeof v.createdAt === 'number'
    && typeof v.title === 'string' && typeof v.kind === 'string' && typeof v.workspaceHash === 'string';
}

/* ================================================================== */
/*  git helpers (best effort — null when git is unavailable)         */
/* ================================================================== */

export interface GitSnapshot {
  headSha?: string;
  dirty?: boolean;
}

export function gitSnapshot(repoRoot: string): GitSnapshot {
  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  const status = git(repoRoot, ['status', '--porcelain']);
  return {
    headSha: head || undefined,
    dirty: status === null ? undefined : status.trim().length > 0,
  };
}

/** `git rev-list --count <headSha>..HEAD` + `git status --porcelain` (spec §4.3). */
export function computeStaleness(repoRoot: string, meta: AtlasMapMeta): AtlasStaleness {
  const status = git(repoRoot, ['status', '--porcelain']);
  const dirtyNow = status !== null && status.trim().length > 0;
  if (!meta.headSha) return { commitsBehind: null, dirtyNow };
  const count = git(repoRoot, ['rev-list', '--count', `${meta.headSha}..HEAD`]);
  const n = count === null ? Number.NaN : Number(count.trim());
  return { commitsBehind: Number.isFinite(n) ? n : null, dirtyNow };
}

function git(repoRoot: string, args: string[]): string | null {
  try {
    const res = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf-8', timeout: 5_000 });
    return res.status === 0 ? res.stdout.trim() : null;
  } catch {
    return null;
  }
}
