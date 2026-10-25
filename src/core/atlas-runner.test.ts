/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildAtlasAllowedTools,
  buildAtlasArgs,
  buildAtlasPrompt,
  evaluateAtlasEligibility,
  locateOutput,
  parseClaudeMajor,
  runAtlas,
  scopeHint,
  summarizeToolInput,
  type AtlasChildLike,
  type AtlasSpawnFn,
} from './atlas-runner';
import type { AtlasProgressEvent } from './types/atlas-types';

class FakeChild extends EventEmitter implements AtlasChildLike {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed: NodeJS.Signals[] = [];
  kill(signal?: NodeJS.Signals): boolean {
    this.killed.push(signal ?? 'SIGTERM');
    // Behave like a real process: exit shortly after SIGTERM.
    setTimeout(() => this.emit('close', null), 5);
    return true;
  }
  line(obj: unknown): void { this.stdout.emit('data', JSON.stringify(obj) + '\n'); }
}

let tmp: string;
let repo: string;
let outDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-runner-'));
  repo = path.join(tmp, 'repo');
  outDir = path.join(tmp, 'store', 'run-1');
  fs.mkdirSync(repo, { recursive: true });
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('evaluateAtlasEligibility', () => {
  const ok = { featureEnabled: true, workspaceRoot: '/w', workspaceTrusted: true, cliVersion: '2.1.310 (Claude Code)', skillPath: '/s', consented: true };
  it('passes when everything is in place', () => {
    expect(evaluateAtlasEligibility(ok)).toEqual({ eligible: true, workspaceRoot: '/w', cliVersion: ok.cliVersion, skillPath: '/s' });
  });
  it('reports reasons in spec order', () => {
    expect(evaluateAtlasEligibility({ ...ok, featureEnabled: false }).reason).toBe('feature-disabled');
    expect(evaluateAtlasEligibility({ ...ok, workspaceRoot: undefined }).reason).toBe('no-workspace');
    expect(evaluateAtlasEligibility({ ...ok, workspaceTrusted: false }).reason).toBe('workspace-untrusted');
    expect(evaluateAtlasEligibility({ ...ok, cliVersion: null }).reason).toBe('cli-missing');
    expect(evaluateAtlasEligibility({ ...ok, cliVersion: '1.0.80' }).reason).toBe('cli-too-old');
    expect(evaluateAtlasEligibility({ ...ok, skillPath: null }).reason).toBe('skill-missing');
    expect(evaluateAtlasEligibility({ ...ok, consented: false }).reason).toBe('consent-missing');
  });
  it('parses the CLI major version', () => {
    expect(parseClaudeMajor('2.1.310 (Claude Code)')).toBe(2);
    expect(parseClaudeMajor('garbage')).toBeNull();
    expect(parseClaudeMajor(null)).toBeNull();
  });
});

describe('command construction', () => {
  it('builds a scoped allow-list with prefix syntax for both skill spellings, never bare Bash', () => {
    const tools = buildAtlasAllowedTools(['/h/.agents/skills/archify', '/h/.claude/skills/archify'], '/repo');
    expect(tools).toContain('Bash(node /h/.agents/skills/archify/bin/archify.mjs:*)');
    expect(tools).toContain('Bash(node /h/.claude/skills/archify/bin/archify.mjs:*)');
    expect(tools).toContain('Bash(git -C /repo rev-parse:*)');
    expect(tools).toContain('Bash(git status:*)');
    expect(tools.split(',')).not.toContain('Bash');
    expect(tools).not.toMatch(/Bash\(\*\)|Bash\(\s*\)/);
  });

  it('spawns with cwd = run dir semantics: --add-dir repo, acceptEdits, optional model/resume, prompt last', () => {
    const args = buildAtlasArgs({ prompt: 'P', allowedTools: 'Read', repoRoot: '/repo', model: 'sonnet', resumeSessionId: 'abc' });
    expect(args.slice(0, 2)).toEqual(['-p', '--output-format']);
    expect(args).toContain('--add-dir');
    expect(args[args.indexOf('--add-dir') + 1]).toBe('/repo');
    expect(args).toContain('acceptEdits');
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(args[args.indexOf('--resume') + 1]).toBe('abc');
    expect(args.at(-1)).toBe('P');
    expect(buildAtlasArgs({ prompt: 'P', allowedTools: 'Read', repoRoot: '/repo' })).not.toContain('--model');
  });

  it('prompts pin the relative output name, --repo-root and the no-repo-writes rule', () => {
    const ctx = { outDir: '/store/run', outputName: 'map.html', repoRoot: '/repo', repoName: 'repo' };
    const full = buildAtlasPrompt({ kind: 'full' }, ctx);
    expect(full).toContain('meta.output to the relative path map.html');
    expect(full).toContain('--repo-root /repo');
    expect(full).toContain('Do not write any file into the repository');
    const overlay = buildAtlasPrompt({ kind: 'session-overlay', highlightFiles: ['src/a.ts'], sourceSessionId: 'sess-12345678' }, ctx);
    expect(overlay).toContain('changed in session sess-12345678');
    expect(overlay).toContain('  - src/a.ts');
    const refine = buildAtlasPrompt({ kind: 'full', baseMapId: 'b', instruction: 'Highlight auth' }, { ...ctx, outputName: 'map-2.html' });
    expect(refine).toContain('Instruction: Highlight auth');
    expect(refine).toContain('/store/run/map-2.html');
    const explain = buildAtlasPrompt({ kind: 'explainer', sourceSessionId: 's', excerpts: ['diff A'] }, ctx);
    expect(explain).toContain('explainer mode');
    expect(explain).toContain('diff A');
  });

  it('summarizes tool inputs for progress chips', () => {
    expect(summarizeToolInput('Bash', { command: 'node x.mjs finalize' })).toBe('node x.mjs finalize');
    expect(summarizeToolInput('Read', { file_path: '/a' })).toBe('/a');
    expect(summarizeToolInput('Grep', { pattern: 'foo' })).toBe('foo');
    expect(summarizeToolInput('Skill', 'nope')).toBe('');
    expect(scopeHint(10)).toBe('small'); expect(scopeHint(500)).toBe('medium'); expect(scopeHint(5000)).toBe('large');
  });
});

describe('runAtlas', () => {
  function fakeSpawn(): { spawn: AtlasSpawnFn; children: FakeChild[]; calls: { bin: string; args: string[]; cwd: string }[] } {
    const children: FakeChild[] = [];
    const calls: { bin: string; args: string[]; cwd: string }[] = [];
    const spawn: AtlasSpawnFn = (bin, args, opts) => {
      calls.push({ bin, args, cwd: opts.cwd });
      const c = new FakeChild();
      children.push(c);
      return c;
    };
    return { spawn, children, calls };
  }

  it('maps stream-json to progress events and returns map meta when the HTML lands', async () => {
    const { spawn, children, calls } = fakeSpawn();
    const events: AtlasProgressEvent[] = [];
    const run = runAtlas({ kind: 'full' }, {
      repoRoot: repo, repoName: 'repo', outDir, outputName: 'map.html', skillPaths: ['/s'],
      spawnFn: spawn, onEvent: e => events.push(e), model: 'sonnet',
    }, 'map-1');
    expect(fs.existsSync(outDir)).toBe(true);
    expect(calls[0].cwd).toBe(outDir);
    expect(calls[0].bin).toBe('claude');
    const child = children[0];
    child.line({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-sonnet-5-5' });
    child.line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node archify.mjs finalize' } }, { type: 'text', text: 'Mapping…\nmore' }] } });
    child.line({ type: 'weird' });
    child.stdout.emit('data', 'not json\n');
    fs.writeFileSync(path.join(outDir, 'map.html'), '<html></html>');
    child.line({ type: 'result', subtype: 'success', duration_ms: 1234, total_cost_usd: 0.42, session_id: 'sess-1' });
    child.emit('close', 0);
    const outcome = await run.promise;
    expect('map' in outcome).toBe(true);
    if ('map' in outcome) {
      expect(outcome.map).toMatchObject({ id: 'map-1', kind: 'full', title: 'Full repository', htmlPath: path.join(outDir, 'map.html'), claudeSessionId: 'sess-1', model: 'claude-sonnet-5-5', durationMs: 1234, costUsd: 0.42 });
    }
    expect(events.map(e => e.kind)).toEqual(['status', 'tool', 'status']);
    expect(events[1]).toEqual({ kind: 'tool', name: 'Bash', summary: 'node archify.mjs finalize' });
    expect(events[2]).toEqual({ kind: 'status', text: 'Mapping…' });
  });

  it('reports an error with the stderr tail when no HTML was produced', async () => {
    const { spawn, children } = fakeSpawn();
    const events: AtlasProgressEvent[] = [];
    const run = runAtlas({ kind: 'full' }, { repoRoot: repo, repoName: 'repo', outDir, outputName: 'map.html', skillPaths: ['/s'], spawnFn: spawn, onEvent: e => events.push(e) });
    children[0].stderr.emit('data', 'permission denied');
    children[0].emit('close', 1);
    const outcome = await run.promise;
    expect(outcome).toEqual({ error: 'claude exited with code 1', stderrTail: 'permission denied' });
    expect(events.at(-1)?.kind).toBe('error');
  });

  it('surfaces is_error results over exit codes', async () => {
    const { spawn, children } = fakeSpawn();
    const run = runAtlas({ kind: 'full' }, { repoRoot: repo, repoName: 'repo', outDir, outputName: 'map.html', skillPaths: ['/s'], spawnFn: spawn });
    children[0].line({ type: 'result', is_error: true, result: 'Not logged in' });
    children[0].emit('close', 0);
    expect(await run.promise).toMatchObject({ error: 'Not logged in' });
  });

  it('cancel() kills the child and resolves cancelled without a map', async () => {
    const { spawn, children } = fakeSpawn();
    const events: AtlasProgressEvent[] = [];
    const run = runAtlas({ kind: 'full' }, { repoRoot: repo, repoName: 'repo', outDir, outputName: 'map.html', skillPaths: ['/s'], spawnFn: spawn, onEvent: e => events.push(e) });
    fs.writeFileSync(path.join(outDir, 'map.html'), 'partial'); // even a partial file must not become a map
    run.cancel();
    const outcome = await run.promise;
    expect(outcome).toEqual({ error: 'cancelled', cancelled: true });
    expect(children[0].killed[0]).toBe('SIGTERM');
    expect(events.at(-1)).toEqual({ kind: 'cancelled' });
  });

  it('times out with SIGTERM → SIGKILL escalation', async () => {
    const children: FakeChild[] = [];
    const spawn: AtlasSpawnFn = () => {
      const c = new FakeChild();
      c.kill = (signal?: NodeJS.Signals) => { c.killed.push(signal ?? 'SIGTERM'); if (signal === 'SIGKILL') setTimeout(() => c.emit('close', null), 1); return true; };
      children.push(c);
      return c;
    };
    const run = runAtlas({ kind: 'full' }, { repoRoot: repo, repoName: 'repo', outDir, outputName: 'map.html', skillPaths: ['/s'], spawnFn: spawn, timeoutMs: 20, killGraceMs: 10 });
    const outcome = await run.promise;
    expect('error' in outcome && outcome.error).toContain('exceeded');
    expect(children[0].killed).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('maps ENOENT to an install hint', async () => {
    const spawn: AtlasSpawnFn = () => { const c = new FakeChild(); setTimeout(() => c.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })), 1); return c; };
    const run = runAtlas({ kind: 'full' }, { repoRoot: repo, repoName: 'repo', outDir, outputName: 'map.html', skillPaths: ['/s'], spawnFn: spawn });
    const outcome = await run.promise;
    expect('error' in outcome && outcome.error).toContain('not found on PATH');
  });
});

describe('locateOutput (file hunt)', () => {
  it('moves a single stray HTML from the repo .archify folder and reports it', () => {
    const started = Date.now() - 50;
    const stray = path.join(repo, '.archify', 'architecture-x', 'x.html');
    fs.mkdirSync(path.dirname(stray), { recursive: true });
    fs.writeFileSync(stray, '<html>');
    const expected = path.join(outDir, 'map.html');
    const res = locateOutput(expected, outDir, repo, started);
    expect(res).toEqual({ path: expected, relocatedFrom: stray });
    expect(fs.existsSync(expected)).toBe(true);
    expect(fs.existsSync(stray)).toBe(false);
  });
  it('refuses to guess between several candidates and ignores old files', () => {
    const started = Date.now() + 10_000; // everything on disk is "old"
    fs.writeFileSync(path.join(repo, 'a.html'), 'a');
    expect(locateOutput(path.join(outDir, 'map.html'), outDir, repo, started).path).toBeUndefined();
    fs.writeFileSync(path.join(repo, 'b.html'), 'b');
    const res = locateOutput(path.join(outDir, 'map.html'), outDir, repo, Date.now() - 60_000);
    expect(res.path).toBeUndefined();
    expect(res.reason).toContain('2 HTML files');
  });
});
