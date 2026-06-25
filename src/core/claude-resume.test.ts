/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClaudeRunner } from './claude-cli';
import {
  continueClaudeSession,
  evaluateSessionChatEligibility,
  findClaudeSessionFile,
  listClaudeSessionsLight,
  readSessionCwd,
  terminalResumeCommand,
} from './claude-resume';

const SESSION_ID = '0eabb490-c980-4bc9-93a0-4be21da759b9';
const FORK_ID = '11111111-2222-3333-4444-555555555555';

function envelope(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'result',
    is_error: false,
    result: 'Sure — done.',
    session_id: SESSION_ID,
    duration_ms: 2400,
    total_cost_usd: 0.018,
    usage: { input_tokens: 19_000, output_tokens: 42 },
    ...extra,
  });
}

const opts = (runner: ClaudeRunner, extra: Record<string, unknown> = {}) =>
  ({ runner, cwd: os.tmpdir(), ...extra });

describe('continueClaudeSession — happy path', () => {
  it('parses the envelope: reply, echoed session id, usage, duration', async () => {
    const runner: ClaudeRunner = () => Promise.resolve({ stdout: envelope(), code: 0 });
    const res = await continueClaudeSession({ sessionId: SESSION_ID, message: 'hi' }, opts(runner));
    expect(res.error).toBeUndefined();
    expect(res.reply).toBe('Sure — done.');
    expect(res.sessionId).toBe(SESSION_ID);
    expect(res.durationMs).toBe(2400);
    expect(res.usage).toEqual({ inputTokens: 19_000, outputTokens: 42, costUsd: 0.018 });
  });

  it('builds exactly the documented arg shape and omits --model by default', async () => {
    let captured: string[] = [];
    const runner: ClaudeRunner = (_stdin, args) => {
      captured = args;
      return Promise.resolve({ stdout: envelope(), code: 0 });
    };
    await continueClaudeSession({ sessionId: SESSION_ID, message: 'hi' }, opts(runner));
    expect(captured).toEqual(['-p', '--resume', SESSION_ID, '--output-format', 'json', '--allowedTools', '']);
  });

  it('passes --model only when a model is configured', async () => {
    let captured: string[] = [];
    const runner: ClaudeRunner = (_stdin, args) => {
      captured = args;
      return Promise.resolve({ stdout: envelope(), code: 0 });
    };
    await continueClaudeSession({ sessionId: SESSION_ID, message: 'hi' }, opts(runner, { model: 'haiku' }));
    expect(captured.slice(-2)).toEqual(['--model', 'haiku']);

    await continueClaudeSession({ sessionId: SESSION_ID, message: 'hi' }, opts(runner, { model: '  ' }));
    expect(captured).not.toContain('--model');
  });

  it('fork adds --fork-session and surfaces the new id from the envelope', async () => {
    let captured: string[] = [];
    const runner: ClaudeRunner = (_stdin, args) => {
      captured = args;
      return Promise.resolve({ stdout: envelope({ session_id: FORK_ID }), code: 0 });
    };
    const res = await continueClaudeSession({ sessionId: SESSION_ID, message: 'hi', fork: true }, opts(runner));
    expect(captured).toContain('--fork-session');
    expect(res.sessionId).toBe(FORK_ID);
  });

  it('pipes the message verbatim over stdin (multiline, quotes, shell metacharacters)', async () => {
    const hostile = 'line one\n`backticks` and $(rm -rf /) and "quotes" \'single\' $HOME\n' + 'x'.repeat(10_000);
    let captured = '';
    const runner: ClaudeRunner = (stdin) => {
      captured = stdin;
      return Promise.resolve({ stdout: envelope(), code: 0 });
    };
    await continueClaudeSession({ sessionId: SESSION_ID, message: hostile }, opts(runner));
    expect(captured).toBe(hostile);
  });
});

describe('continueClaudeSession — failures return { error }, never throw', () => {
  it('error envelope', async () => {
    const runner: ClaudeRunner = () => Promise.resolve({
      stdout: JSON.stringify({ type: 'result', is_error: true, result: 'No conversation found with session ID' }),
      code: 1,
    });
    const res = await continueClaudeSession({ sessionId: SESSION_ID, message: 'hi' }, opts(runner));
    expect(res.reply).toBe('');
    expect(res.error).toMatch(/No conversation found/);
  });

  it('non-zero exit with no parseable output', async () => {
    const runner: ClaudeRunner = () => Promise.resolve({ stdout: 'garbage', code: 2 });
    const res = await continueClaudeSession({ sessionId: SESSION_ID, message: 'hi' }, opts(runner));
    expect(res.error).toMatch(/exited with code 2/);
  });

  it('timeout', async () => {
    const runner: ClaudeRunner = () => Promise.reject(new Error('claude timed out after 120000ms'));
    const res = await continueClaudeSession({ sessionId: SESSION_ID, message: 'hi' }, opts(runner));
    expect(res.error).toMatch(/timed out/);
  });

  it('ENOENT maps to a friendly install hint', async () => {
    const runner: ClaudeRunner = () => {
      const err = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      return Promise.reject(err);
    };
    const res = await continueClaudeSession({ sessionId: SESSION_ID, message: 'hi' }, opts(runner));
    expect(res.error).toMatch(/not found on PATH/);
  });

  it('empty reply in a success envelope is treated as a failure', async () => {
    const runner: ClaudeRunner = () => Promise.resolve({ stdout: envelope({ result: '  ' }), code: 0 });
    const res = await continueClaudeSession({ sessionId: SESSION_ID, message: 'hi' }, opts(runner));
    expect(res.error).toMatch(/empty reply/);
  });

  it('rejects malformed session ids before spawning anything', async () => {
    let spawned = false;
    const runner: ClaudeRunner = () => { spawned = true; return Promise.resolve({ stdout: envelope(), code: 0 }); };
    const res = await continueClaudeSession({ sessionId: '../../etc/passwd', message: 'hi' }, opts(runner));
    expect(res.error).toMatch(/Invalid session id/);
    expect(spawned).toBe(false);
  });
});

/* ================================================================== */
/*  Filesystem helpers — real fs against temp fixtures               */
/* ================================================================== */

const tempDirs: string[] = [];

function makeProjectsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-session-chat-'));
  tempDirs.push(dir);
  return dir;
}

function writeSessionFile(projectsDir: string, slug: string, sessionId: string, lines: unknown[]): string {
  const projDir = path.join(projectsDir, slug);
  fs.mkdirSync(projDir, { recursive: true });
  const filePath = path.join(projDir, `${sessionId}.jsonl`);
  fs.writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return filePath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const userLine = (text: string, cwd?: string) => ({
  type: 'user',
  cwd,
  message: { role: 'user', content: [{ type: 'text', text }] },
});

describe('findClaudeSessionFile', () => {
  it('finds a session by basename across project dirs', () => {
    const projectsDir = makeProjectsDir();
    writeSessionFile(projectsDir, '-Users-x-other', FORK_ID, [userLine('nope')]);
    const expected = writeSessionFile(projectsDir, '-Users-x-proj', SESSION_ID, [userLine('hello')]);
    expect(findClaudeSessionFile(SESSION_ID, projectsDir)).toBe(expected);
  });

  it('returns null for unknown ids and unsafe ids', () => {
    const projectsDir = makeProjectsDir();
    writeSessionFile(projectsDir, '-Users-x-proj', SESSION_ID, [userLine('hello')]);
    expect(findClaudeSessionFile(FORK_ID, projectsDir)).toBeNull();
    expect(findClaudeSessionFile('../escape', projectsDir)).toBeNull();
    expect(findClaudeSessionFile('a', projectsDir)).toBeNull();
  });
});

describe('readSessionCwd', () => {
  it('returns the first cwd recorded in the file head', () => {
    const projectsDir = makeProjectsDir();
    const filePath = writeSessionFile(projectsDir, '-p', SESSION_ID, [
      { type: 'queue-operation' },
      userLine('hello', '/tmp/proj-a'),
      userLine('again', '/tmp/proj-b'),
    ]);
    expect(readSessionCwd(filePath)).toBe('/tmp/proj-a');
  });

  it('returns null when no cwd is recorded', () => {
    const projectsDir = makeProjectsDir();
    const filePath = writeSessionFile(projectsDir, '-p', SESSION_ID, [userLine('hello')]);
    expect(readSessionCwd(filePath)).toBeNull();
  });
});

describe('evaluateSessionChatEligibility', () => {
  const base = () => {
    const projectsDir = makeProjectsDir();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-cwd-'));
    tempDirs.push(cwd);
    writeSessionFile(projectsDir, '-p', SESSION_ID, [userLine('hello', cwd)]);
    return { projectsDir, cwd };
  };

  it('eligible: resolves file + cwd; respects the mtime override knobs', () => {
    const { projectsDir, cwd } = base();
    // A freshly written fixture is always "recently active" — verify the guard…
    const guarded = evaluateSessionChatEligibility({
      sessionId: SESSION_ID, featureEnabled: true, cliAvailable: true, projectsDir,
    });
    expect(guarded.eligible).toBe(false);
    expect(guarded.reason).toBe('recently-active');
    // …the explicit user override…
    const overridden = evaluateSessionChatEligibility({
      sessionId: SESSION_ID, featureEnabled: true, cliAvailable: true, projectsDir, ignoreRecentActivity: true,
    });
    expect(overridden.eligible).toBe(true);
    expect(overridden.resolvedCwd).toBe(cwd);
    expect(overridden.sessionFilePath).toMatch(new RegExp(`${SESSION_ID}\\.jsonl$`));
    // …and the normal aged-file path (simulated clock).
    const aged = evaluateSessionChatEligibility({
      sessionId: SESSION_ID, featureEnabled: true, cliAvailable: true, projectsDir, now: Date.now() + 120_000,
    });
    expect(aged.eligible).toBe(true);
  });

  it('feature-disabled wins over everything', () => {
    const res = evaluateSessionChatEligibility({
      sessionId: SESSION_ID, featureEnabled: false, cliAvailable: true,
    });
    expect(res.reason).toBe('feature-disabled');
  });

  it('not-claude for other harnesses', () => {
    const res = evaluateSessionChatEligibility({
      sessionId: SESSION_ID, featureEnabled: true, cliAvailable: true, harness: 'Codex',
    });
    expect(res.reason).toBe('not-claude');
    expect(res.detail).toMatch(/Codex/);
  });

  it('cli-missing', () => {
    const res = evaluateSessionChatEligibility({
      sessionId: SESSION_ID, featureEnabled: true, cliAvailable: false, harness: 'Claude',
    });
    expect(res.reason).toBe('cli-missing');
  });

  it('no-session-file', () => {
    const projectsDir = makeProjectsDir();
    const res = evaluateSessionChatEligibility({
      sessionId: SESSION_ID, featureEnabled: true, cliAvailable: true, projectsDir,
    });
    expect(res.reason).toBe('no-session-file');
  });

  it('no-cwd when neither the parse nor the jsonl knows a directory', () => {
    const projectsDir = makeProjectsDir();
    writeSessionFile(projectsDir, '-p', SESSION_ID, [userLine('hello')]);
    const res = evaluateSessionChatEligibility({
      sessionId: SESSION_ID, featureEnabled: true, cliAvailable: true, projectsDir,
    });
    expect(res.reason).toBe('no-cwd');
  });

  it('cwd-missing when the recorded directory was deleted (worktree case)', () => {
    const projectsDir = makeProjectsDir();
    const goneCwd = path.join(os.tmpdir(), 'coach-gone-worktree-does-not-exist');
    writeSessionFile(projectsDir, '-p', SESSION_ID, [userLine('hello', goneCwd)]);
    const res = evaluateSessionChatEligibility({
      sessionId: SESSION_ID, featureEnabled: true, cliAvailable: true, projectsDir,
    });
    expect(res.reason).toBe('cwd-missing');
    expect(res.resolvedCwd).toBe(goneCwd);
  });

  it('prefers workspaceRootPath from the parse over the jsonl cwd', () => {
    const { projectsDir } = base();
    const preferred = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-preferred-'));
    tempDirs.push(preferred);
    const res = evaluateSessionChatEligibility({
      sessionId: SESSION_ID, featureEnabled: true, cliAvailable: true, projectsDir,
      workspaceRootPath: preferred, ignoreRecentActivity: true,
    });
    expect(res.resolvedCwd).toBe(preferred);
  });
});

describe('listClaudeSessionsLight', () => {
  it('lists sessions grouped by project, newest first, with first prompt + cwd', () => {
    const projectsDir = makeProjectsDir();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-list-cwd-'));
    tempDirs.push(cwd);
    const older = writeSessionFile(projectsDir, '-p-one', SESSION_ID, [userLine('first prompt here', cwd)]);
    fs.utimesSync(older, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    writeSessionFile(projectsDir, '-p-one', FORK_ID, [userLine('newer prompt', cwd)]);

    const projects = listClaudeSessionsLight(projectsDir);
    expect(projects).toHaveLength(1);
    expect(projects[0].projectName).toBe(path.basename(cwd));
    expect(projects[0].totalSessions).toBe(2);
    expect(projects[0].sessions.map(s => s.sessionId)).toEqual([FORK_ID, SESSION_ID]);
    expect(projects[0].sessions[1].firstUserText).toBe('first prompt here');
    expect(projects[0].sessions[0].cwd).toBe(cwd);
  });

  it('caps sessions per project but reports the true total', () => {
    const projectsDir = makeProjectsDir();
    for (let i = 0; i < 5; i++) {
      writeSessionFile(projectsDir, '-p-many', `aaaaaaaa-0000-0000-0000-00000000000${i}`, [userLine(`p${i}`)]);
    }
    const projects = listClaudeSessionsLight(projectsDir, { perProjectCap: 3 });
    expect(projects[0].sessions).toHaveLength(3);
    expect(projects[0].totalSessions).toBe(5);
  });

  it('skips slash-command wrappers when picking the label text', () => {
    const projectsDir = makeProjectsDir();
    writeSessionFile(projectsDir, '-p', SESSION_ID, [
      userLine('<command-name>/clear</command-name>'),
      userLine('real prompt'),
    ]);
    const projects = listClaudeSessionsLight(projectsDir);
    expect(projects[0].sessions[0].firstUserText).toBe('real prompt');
  });
});

describe('terminalResumeCommand', () => {
  it('quotes cwds with spaces and leaves clean paths bare', () => {
    expect(terminalResumeCommand(SESSION_ID, '/tmp/proj')).toBe(`cd /tmp/proj && claude --resume ${SESSION_ID}`);
    expect(terminalResumeCommand(SESSION_ID, '/tmp/my proj')).toBe(`cd '/tmp/my proj' && claude --resume ${SESSION_ID}`);
    expect(terminalResumeCommand(SESSION_ID)).toBe(`claude --resume ${SESSION_ID}`);
  });
});
