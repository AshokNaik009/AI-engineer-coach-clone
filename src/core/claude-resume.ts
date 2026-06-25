/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Session continuation engine — pure core, no VS Code dependency.
 *
 * Shells out to the local `claude` binary with `--resume <sessionId>` to append
 * one turn to an existing Claude Code session. Hard constraints:
 *   - `--allowedTools ""` — Phase 1 is conversation-only; the resumed turn can
 *     never touch the filesystem or run commands.
 *   - cwd MUST be the session's original project directory: the CLI locates the
 *     session file by encoding the cwd into the project-slug directory name.
 *   - the message is piped over stdin (not argv) — safe for large/multiline
 *     text and immune to shell quoting (spawn runs with shell:false).
 *   - no `--model` flag by default: resuming inherits the user's CLI config
 *     (a panel-created Haiku session resumed under a default-Opus config would
 *     silently 10× per-turn cost).
 *   - no heuristic fallback (unlike Prompt Studio) — a chat cannot fake a
 *     reply. Every failure surfaces as `{ error }`, never a throw.
 */

import * as fs from 'fs';
import * as path from 'path';
import { defaultClaudeRunner, extractJsonObject, type ClaudeRunner } from './claude-cli';
import { assertTrustedPath } from './parser-shared';
import type {
  ClaudeProjectListing,
  ClaudeSessionListing,
  SessionChatEligibility,
  SessionChatSendParams,
  SessionChatTurn,
  SessionChatUsage,
} from './types/session-chat-types';

/** A resumed session re-hydrates its full transcript before answering, so the
 *  Prompt Studio 60s budget is too tight; TTFT grows with transcript size. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** jsonl modified more recently than this is treated as possibly having
 *  another live writer (terminal CLI, official panel). Heuristic only —
 *  there is no public lock-file contract. */
const RECENT_ACTIVITY_MS = 60_000;

/** Session ids are jsonl basenames and CLI argv values — restrict hard. */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

/** Bytes read from the head of a session file for cwd / first-prompt sniffing.
 *  Avoids loading multi-MB transcripts just to label a tree node. */
const HEAD_SNIFF_BYTES = 256 * 1024;

export function defaultClaudeProjectsDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.claude', 'projects');
}

/* ================================================================== */
/*  Continue a session (one turn)                                     */
/* ================================================================== */

export interface ClaudeResumeOptions {
  /** Directory the CLI is spawned in — must be the session's original cwd. */
  cwd: string;
  /** Binary to invoke (default `claude`, resolved via PATH). */
  binPath?: string;
  /** Kill the process after this many ms (default 120s). */
  timeoutMs?: number;
  /** Model passed to `--model`; empty/undefined = inherit the CLI config. */
  model?: string;
  /** Injectable process runner — tests pass a fake so nothing is spawned. */
  runner?: ClaudeRunner;
}

export async function continueClaudeSession(
  params: SessionChatSendParams,
  opts: ClaudeResumeOptions,
): Promise<SessionChatTurn> {
  const failed = (error: string): SessionChatTurn => ({ reply: '', sessionId: params.sessionId, error });

  if (!SESSION_ID_RE.test(params.sessionId)) return failed('Invalid session id.');
  if (!params.message.trim()) return failed('Empty message.');

  const binPath = opts.binPath || 'claude';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const runner = opts.runner ?? defaultClaudeRunner;

  const args = ['-p', '--resume', params.sessionId, '--output-format', 'json', '--allowedTools', ''];
  if (params.fork) args.push('--fork-session');
  if (opts.model && opts.model.trim()) args.push('--model', opts.model.trim());

  try {
    const { stdout, code } = await runner(params.message, args, { cwd: opts.cwd, timeoutMs, binPath });
    return parseResumeEnvelope(stdout, code, params.sessionId);
  } catch (err) {
    return failed(resumeErrorMessage(err));
  }
}

function parseResumeEnvelope(stdout: string, code: number | null, inputSessionId: string): SessionChatTurn {
  const failed = (error: string): SessionChatTurn => ({ reply: '', sessionId: inputSessionId, error });

  const envelopeText = extractJsonObject(stdout);
  if (!envelopeText) {
    return failed(code === 0
      ? 'claude returned no parseable result.'
      : `claude exited with code ${code} and no parseable result.`);
  }

  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(envelopeText) as Record<string, unknown>;
  } catch {
    return failed('claude returned malformed JSON.');
  }

  if (envelope.is_error === true) {
    const detail = typeof envelope.result === 'string' && envelope.result.trim() ? envelope.result.trim() : 'claude reported an error.';
    return failed(detail);
  }

  const reply = typeof envelope.result === 'string' ? envelope.result : '';
  if (!reply.trim()) return failed('claude returned an empty reply.');

  return {
    reply,
    // Echo the envelope's id: equals the input id on a plain resume, and the
    // *new* branch id on `--fork-session`. The UI compares this to the input
    // id as the tripwire for a future CLI flipping the resume default.
    sessionId: typeof envelope.session_id === 'string' && envelope.session_id ? envelope.session_id : inputSessionId,
    durationMs: typeof envelope.duration_ms === 'number' ? envelope.duration_ms : undefined,
    usage: extractResumeUsage(envelope),
  };
}

function extractResumeUsage(envelope: Record<string, unknown>): SessionChatUsage | undefined {
  const usage = envelope.usage;
  const costUsd = typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  if (usage && typeof usage === 'object') {
    const u = usage as Record<string, unknown>;
    if (typeof u.input_tokens === 'number') inputTokens = u.input_tokens;
    if (typeof u.output_tokens === 'number') outputTokens = u.output_tokens;
  }
  if (inputTokens === undefined && outputTokens === undefined && costUsd === undefined) return undefined;
  return { inputTokens, outputTokens, costUsd };
}

function resumeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'The `claude` CLI was not found on PATH. Install Claude Code or set aiEngineerCoach.sessionChat.binPath.';
    }
    // GUI-launched VS Code often lacks shell-profile env (ANTHROPIC_API_KEY,
    // CLAUDE_CODE_*) — point at the terminal instead of a generic failure.
    if (/api key|authent|unauthorized|logged? ?in/i.test(err.message)) {
      return `Claude CLI authentication failed: ${err.message}\nRun \`claude\` once in a terminal to sign in, or check your API key environment.`;
    }
    return err.message;
  }
  return String(err);
}

/* ================================================================== */
/*  Session file discovery + cwd resolution                           */
/* ================================================================== */

/**
 * Locate `<sessionId>.jsonl` by basename across all project dirs under
 * `~/.claude/projects/`. Searching by basename (instead of re-deriving the
 * cwd→slug encoding) sidesteps the Windows-drive and worktree edge cases of
 * the encoder.
 */
export function findClaudeSessionFile(sessionId: string, projectsDir = defaultClaudeProjectsDir()): string | null {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(projectsDir, entry.name, `${sessionId}.jsonl`);
    try {
      if (!fs.existsSync(candidate)) continue;
      assertTrustedPath(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function readFileHead(filePath: string): string | null {
  assertTrustedPath(filePath);
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(HEAD_SNIFF_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf-8', 0, bytesRead);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

/** Lines fully contained in the head read (the last one may be truncated). */
function headLines(head: string): string[] {
  const lines = head.split('\n');
  if (!head.endsWith('\n')) lines.pop();
  return lines.filter(l => l.trim().length > 0);
}

/** First `cwd` value found among the head lines, or null. */
function firstCwdFromHead(head: string): string | null {
  for (const line of headLines(head)) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed.cwd === 'string' && parsed.cwd) return parsed.cwd;
    } catch {
      continue;
    }
  }
  return null;
}

/** First `cwd` recorded in the session file head, or null. */
export function readSessionCwd(filePath: string): string | null {
  const head = readFileHead(filePath);
  if (head === null) return null;
  return firstCwdFromHead(head);
}

/* ================================================================== */
/*  Eligibility                                                       */
/* ================================================================== */

export interface SessionChatEligibilityInput {
  sessionId: string;
  /** `aiEngineerCoach.sessionChat.enabled` setting value. */
  featureEnabled: boolean;
  /** Result of the (cached) `claude --version` probe. */
  cliAvailable: boolean;
  /** Harness of the parsed session when known; undefined skips the check. */
  harness?: string;
  /** Parsed session's resolved cwd, when known (preferred over the jsonl). */
  workspaceRootPath?: string;
  projectsDir?: string;
  /** Explicit "continue anyway" override for the mtime heuristic. */
  ignoreRecentActivity?: boolean;
  recentActiveMs?: number;
  now?: number;
}

/**
 * Encodes the §3.3 eligibility rules. Pure + synchronous: every rule is either
 * an input flag or a local fs probe, so the RPC handler stays a thin shim.
 */
export function evaluateSessionChatEligibility(input: SessionChatEligibilityInput): SessionChatEligibility {
  if (!input.featureEnabled) {
    return {
      eligible: false,
      reason: 'feature-disabled',
      detail: 'Session Chat is off. Enable the aiEngineerCoach.sessionChat.enabled setting to continue sessions from the dashboard.',
    };
  }

  if (input.harness !== undefined && input.harness !== 'Claude') {
    return {
      eligible: false,
      reason: 'not-claude',
      detail: `Only Claude Code sessions can be continued — this is a ${input.harness} session.`,
    };
  }

  if (!input.cliAvailable) {
    return {
      eligible: false,
      reason: 'cli-missing',
      detail: 'The `claude` CLI was not found. Install Claude Code (https://claude.com/claude-code) or point aiEngineerCoach.sessionChat.binPath at the binary.',
    };
  }

  const sessionFilePath = findClaudeSessionFile(input.sessionId, input.projectsDir);
  if (!sessionFilePath) {
    return {
      eligible: false,
      reason: 'no-session-file',
      detail: `No ${input.sessionId}.jsonl found under ~/.claude/projects — the session history may have been deleted.`,
    };
  }

  const cwd = input.workspaceRootPath || readSessionCwd(sessionFilePath);
  if (!cwd) {
    return {
      eligible: false,
      reason: 'no-cwd',
      detail: 'The session never recorded a working directory, so the CLI cannot be pointed at the right project.',
      sessionFilePath,
    };
  }

  if (!fs.existsSync(cwd)) {
    return {
      eligible: false,
      reason: 'cwd-missing',
      detail: `The session's project directory no longer exists: ${cwd} (common for sessions born in throwaway git worktrees).`,
      sessionFilePath,
      resolvedCwd: cwd,
    };
  }

  if (!input.ignoreRecentActivity) {
    const recentMs = input.recentActiveMs ?? RECENT_ACTIVITY_MS;
    const now = input.now ?? Date.now();
    try {
      const mtimeMs = fs.statSync(sessionFilePath).mtimeMs;
      if (now - mtimeMs < recentMs) {
        return {
          eligible: false,
          reason: 'recently-active',
          detail: 'This session was written to in the last minute — it may be open in a terminal or the Claude panel. Continuing now could interleave writers.',
          sessionFilePath,
          resolvedCwd: cwd,
        };
      }
    } catch {
      /* stat raced a deletion — the send will surface its own error */
    }
  }

  return { eligible: true, sessionFilePath, resolvedCwd: cwd };
}

/* ================================================================== */
/*  Lightweight session listing (Sessions tree view)                  */
/* ================================================================== */

/** Minimal mirror of the parser's user-line text extraction, applied only to
 *  the file head — labelling a tree node must not full-parse every session. */
function firstUserTextFromHead(head: string): string {
  for (const line of headLines(head)) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (parsed.type !== 'user') continue;
    const message = parsed.message as Record<string, unknown> | undefined;
    const content = message?.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b): b is { type: string; text?: string } => typeof b === 'object' && b !== null)
        .filter(b => b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text as string)
        .join('\n');
    }
    text = text.trim();
    if (!text) continue;
    // Skip slash-command wrappers and interrupt markers, same as the parser.
    if (/^<(local-)?command-/.test(text)) continue;
    if (text.startsWith('[Request interrupted')) continue;
    return text;
  }
  return '';
}

export interface ListClaudeSessionsOptions {
  /** Most-recent sessions kept per project (default 20). */
  perProjectCap?: number;
}

/**
 * Direct scan of `~/.claude/projects/**` reading only file mtimes plus a
 * bounded head sniff per kept session. Used by the Sessions tree view when the
 * dashboard's full parse is not in memory.
 */
export function listClaudeSessionsLight(
  projectsDir = defaultClaudeProjectsDir(),
  opts: ListClaudeSessionsOptions = {},
): ClaudeProjectListing[] {
  const cap = opts.perProjectCap ?? 20;
  let projectDirs: fs.Dirent[];
  try {
    projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(e => e.isDirectory());
  } catch {
    return [];
  }

  const projects: ClaudeProjectListing[] = [];
  for (const projDir of projectDirs) {
    const projPath = path.join(projectsDir, projDir.name);
    let files: { sessionId: string; filePath: string; mtimeMs: number }[];
    try {
      files = fs.readdirSync(projPath, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.jsonl'))
        .map(e => {
          const filePath = path.join(projPath, e.name);
          let mtimeMs = 0;
          try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch { /* keep 0 */ }
          return { sessionId: e.name.slice(0, -'.jsonl'.length), filePath, mtimeMs };
        });
    } catch {
      continue;
    }
    if (files.length === 0) continue;

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const kept = files.slice(0, cap);

    let projectName = '';
    const sessions: ClaudeSessionListing[] = [];
    for (const file of kept) {
      const head = readFileHead(file.filePath) ?? '';
      const cwd = firstCwdFromHead(head) ?? undefined;
      if (!projectName && cwd) projectName = path.basename(cwd);
      sessions.push({
        sessionId: file.sessionId,
        filePath: file.filePath,
        projectName: cwd ? path.basename(cwd) : projDir.name,
        firstUserText: firstUserTextFromHead(head),
        mtimeMs: file.mtimeMs,
        cwd,
      });
    }

    projects.push({
      projectName: projectName || projDir.name,
      dirName: projDir.name,
      totalSessions: files.length,
      sessions,
    });
  }

  // Newest project group first (by its newest session).
  projects.sort((a, b) => (b.sessions[0]?.mtimeMs ?? 0) - (a.sessions[0]?.mtimeMs ?? 0));
  return projects;
}

/** Quote a path for the copyable terminal fallback shown in ineligible cards. */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_\-./~]+$/.test(value)) return value;
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/** Build the copyable terminal fallback command for a session. */
export function terminalResumeCommand(sessionId: string, cwd?: string): string {
  const resume = `claude --resume ${sessionId}`;
  return cwd ? `cd ${shellQuote(cwd)} && ${resume}` : resume;
}
