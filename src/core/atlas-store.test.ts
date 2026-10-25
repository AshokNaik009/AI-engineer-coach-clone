/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AtlasStore, computeStaleness, gitSnapshot, workspaceHash } from './atlas-store';
import type { AtlasMapMeta } from './types/atlas-types';

let tmp: string;
let repo: string;
let store: AtlasStore;

function meta(id: string, htmlPath: string, extra: Partial<AtlasMapMeta> = {}): AtlasMapMeta {
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, `<html>${id}</html>`);
  fs.writeFileSync(htmlPath.replace(/\.html$/, '.finalize.json'), '{}');
  return { id, workspaceHash: workspaceHash(repo), createdAt: Number(id.split('-')[0]), title: id, kind: 'full', htmlPath, ...extra };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-store-'));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  store = new AtlasStore(path.join(tmp, 'storage'), repo);
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('AtlasStore', () => {
  it('lists newest first, prunes beyond maxMaps and deletes pruned files', () => {
    const a = meta('100-a', path.join(store.runDir('100-a'), 'map.html'));
    const b = meta('200-b', path.join(store.runDir('200-b'), 'map.html'));
    const c = meta('300-c', path.join(store.runDir('300-c'), 'map.html'));
    store.insert(a, 2);
    store.insert(b, 2);
    const maps = store.insert(c, 2);
    expect(maps.map(m => m.id)).toEqual(['300-c', '200-b']);
    expect(store.list().map(m => m.id)).toEqual(['300-c', '200-b']);
    expect(fs.existsSync(a.htmlPath)).toBe(false);
    expect(fs.existsSync(store.runDir('100-a'))).toBe(false);
    expect(fs.existsSync(b.htmlPath)).toBe(true);
  });

  it('delete removes only the map’s own files when a refinement shares the run dir', () => {
    const base = meta('100-a', path.join(store.runDir('100-a'), 'map.html'));
    const refined = meta('200-b', path.join(store.runDir('100-a'), 'map-200-b.html'), { baseMapId: '100-a' });
    store.insert(base, 10);
    store.insert(refined, 10);
    expect(store.delete('100-a')).toBe(true);
    expect(fs.existsSync(base.htmlPath)).toBe(false);
    expect(fs.existsSync(base.htmlPath.replace(/\.html$/, '.finalize.json'))).toBe(false);
    expect(fs.existsSync(refined.htmlPath)).toBe(true);
    expect(store.list().map(m => m.id)).toEqual(['200-b']);
    expect(store.delete('nope')).toBe(false);
  });

  it('exportTo writes a byte-identical copy and leaves the store untouched', () => {
    const a = meta('100-a', path.join(store.runDir('100-a'), 'map.html'));
    store.insert(a, 10);
    const dest = path.join(tmp, 'docs', 'atlas.html');
    store.exportTo('100-a', dest);
    expect(fs.readFileSync(dest)).toEqual(fs.readFileSync(a.htmlPath));
    expect(() => store.exportTo('missing', dest)).toThrow('Map not found.');
  });

  it('tolerates a corrupt index', () => {
    fs.mkdirSync(store.dir, { recursive: true });
    fs.writeFileSync(path.join(store.dir, 'index.json'), '{not json');
    expect(store.list()).toEqual([]);
  });
});

describe('git helpers', () => {
  it('report commits behind and dirty state; null without git', () => {
    try {
      execSync('git init -q && git -c user.email=a@b -c user.name=t commit -q --allow-empty -m one', { cwd: repo, stdio: 'ignore' });
    } catch {
      return; // git unavailable on this machine
    }
    const snap = gitSnapshot(repo);
    expect(snap.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(snap.dirty).toBe(false);
    const m: AtlasMapMeta = { id: 'x', workspaceHash: 'h', createdAt: 1, title: 't', kind: 'full', htmlPath: '/x', headSha: snap.headSha };
    expect(computeStaleness(repo, m)).toEqual({ commitsBehind: 0, dirtyNow: false });
    execSync('git -c user.email=a@b -c user.name=t commit -q --allow-empty -m two', { cwd: repo, stdio: 'ignore' });
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    expect(computeStaleness(repo, m)).toEqual({ commitsBehind: 1, dirtyNow: true });
    expect(computeStaleness(repo, { ...m, headSha: undefined }).commitsBehind).toBeNull();
    expect(computeStaleness(path.join(tmp, 'nogit'), m)).toEqual({ commitsBehind: null, dirtyNow: false });
  });
});
