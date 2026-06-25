/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Live session chat process — pure core, no VS Code dependency (spec §4.1).
 *
 * One long-lived child per active conversation:
 *
 *   claude -p --resume <sessionId> \
 *     --input-format stream-json --output-format stream-json \
 *     --include-partial-messages [--permission-mode <mode>]
 *
 * Hard constraints:
 *   - permissionMode 'none' (default) keeps Phase 1's conversation-only
 *     posture (`--allowedTools ""`); 'plan'/'acceptEdits' pass
 *     `--permission-mode <mode>` instead.
 *   - user turns go to stdin as JSONL frames — never argv (large/multiline
 *     safe, no shell quoting; spawn runs with shell:false).
 *   - stdout is parsed line-buffered and defensively: unknown event types and
 *     malformed JSON lines are dropped silently (spec §5.1 schema drift).
 *   - shutdown escalates SIGTERM → 3 s → SIGKILL; 5 min without a send
 *     idle-kills the process. The idle kill is invisible to the user: state
 *     lives in the jsonl, so the next send respawns with `--resume`.
 *   - module-level registry caps concurrency at 2 (each child re-hydrates a
 *     full transcript in memory); creating a 3rd evicts the least-recently-
 *     used one first.
 */

import { spawn } from 'child_process';
import type {
  ChatEvent,
  ChatToolUse,
  SessionChatPermissionMode,
  SessionChatUsage,
} from './types/session-chat-types';

/** Grace between SIGTERM and the SIGKILL escalation. */
const SIGKILL_GRACE_MS = 3_000;

/** A warm process pays nothing while idle, but it pins the session as
 *  "active" for other writers (spec §5.4) — kill after 5 min without a send. */
const IDLE_TIMEOUT_MS = 5 * 60_000;

/** Each live child holds a full transcript in memory — hard cap. */
const MAX_CHAT_PROCESSES = 2;

/** Tool-input previews are chips, not payloads — keep them short. */
const INPUT_PREVIEW_MAX = 120;

/** Keep only the tail of stderr for the closed-event error detail. */
const STDERR_TAIL_MAX = 2_000;

/** Session ids are jsonl basenames and CLI argv values — restrict hard
 *  (same guard as claude-resume.ts). */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

/* ================================================================== */
/*  Injectable spawn                                                  */
/* ================================================================== */

/** The slice of ChildProcess this module touches — tests fake exactly this. */
export interface ChatChildLike {
  stdin: { write(chunk: string): unknown } | null;
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

/** Injectable process factory — tests pass a fake so nothing real runs. */
export type ChatSpawnFn = (binPath: string, args: string[], opts: { cwd: string }) => ChatChildLike;

const defaultChatSpawn: ChatSpawnFn = (binPath, args, opts) =>
  spawn(binPath, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false });

/* ================================================================== */
/*  Options                                                           */
/* ================================================================== */

export interface ClaudeChatProcessOptions {
  /** UUID == jsonl basename of the session to resume. */
  sessionId: string;
  /** Directory the CLI is spawned in — must be the session's original cwd. */
  cwd: string;
  /** Binary to invoke (default `claude`, resolved via PATH). */
  binPath?: string;
  /** Model passed to `--model`; empty/undefined = inherit the CLI config. */
  model?: string;
  /** 'none' (default) = conversation-only; 'plan'/'acceptEdits' run tools. */
  permissionMode?: SessionChatPermissionMode;
  /** Injectable spawn — tests pass a fake so nothing is spawned. */
  spawnFn?: ChatSpawnFn;
  /** Override the 5-min idle kill (tests only). */
  idleTimeoutMs?: number;
  /** Override the SIGTERM→SIGKILL grace (tests only). */
  killGraceMs?: number;
}

function buildChatArgs(opts: ClaudeChatProcessOptions): string[] {
  const args = [
    '-p',
    '--resume', opts.sessionId,
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--include-partial-messages',
  ];
  const mode = opts.permissionMode ?? 'none';
  if (mode === 'plan' || mode === 'acceptEdits') {
    args.push('--permission-mode', mode);
  } else {
    // Same conversation-only posture as Phase 1: no tools, ever.
    args.push('--allowedTools', '');
  }
  if (opts.model && opts.model.trim()) args.push('--model', opts.model.trim());
  return args;
}

/* ================================================================== */
/*  ClaudeChatProcess                                                 */
/* ================================================================== */

export class ClaudeChatProcess {
  readonly sessionId: string;

  private readonly child: ChatChildLike;
  private readonly listeners = new Set<(e: ChatEvent) => void>();
  private readonly idleTimeoutMs: number;
  private readonly killGraceMs: number;

  private stdoutBuffer = '';
  private stderrTail = '';
  private closedEmitted = false;
  private disposed = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private killTimer: ReturnType<typeof setTimeout> | undefined;
  private interruptSeq = 0;

  constructor(opts: ClaudeChatProcessOptions) {
    if (!SESSION_ID_RE.test(opts.sessionId)) {
      throw new Error(`Invalid session id: ${opts.sessionId}`);
    }
    this.sessionId = opts.sessionId;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.killGraceMs = opts.killGraceMs ?? SIGKILL_GRACE_MS;

    const spawnFn = opts.spawnFn ?? defaultChatSpawn;
    this.child = spawnFn(opts.binPath || 'claude', buildChatArgs(opts), { cwd: opts.cwd });

    this.child.stdout?.on('data', (chunk) => { this.handleStdout(chunk); });
    this.child.stderr?.on('data', (chunk) => { this.appendStderr(chunk); });
    this.child.on('error', (err: Error) => { this.handleSpawnError(err); });
    this.child.on('close', (code: number | null) => { this.handleClose(code); });

    this.resetIdleTimer();
  }

  /** True once the `closed` event has been emitted — the instance is dead;
   *  the registry replaces (never reuses) a closed process. */
  get isClosed(): boolean {
    return this.closedEmitted;
  }

  onEvent(cb: (e: ChatEvent) => void): { dispose(): void } {
    this.listeners.add(cb);
    return { dispose: () => { this.listeners.delete(cb); } };
  }

  /** Queue one user turn. No-op once the process is closed/disposed — the
   *  caller respawns via the registry (state lives in the jsonl). */
  send(text: string): void {
    if (this.disposed || this.closedEmitted) return;
    this.resetIdleTimer();
    this.writeFrame({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
    });
  }

  /** Stop the in-flight generation, leaving the process reusable.
   *
   *  Contract note: `claude --help` (v2.1.173, verified on this machine)
   *  documents the stream-json input format but not an interrupt frame. The
   *  frame below is the control-protocol request used by the Claude Agent
   *  SDK's stream-json transport. If a CLI version instead reacts by closing
   *  the stream, the resulting `closed` event is acceptable (spec §4.5): the
   *  next send transparently respawns with `--resume`. */
  interrupt(): void {
    if (this.disposed || this.closedEmitted) return;
    this.interruptSeq += 1;
    this.writeFrame({
      type: 'control_request',
      request_id: `interrupt-${Date.now()}-${this.interruptSeq}`,
      request: { subtype: 'interrupt' },
    });
  }

  /** Escalating shutdown: SIGTERM now, SIGKILL after 3 s if still alive. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearIdleTimer();
    try { this.child.kill('SIGTERM'); } catch { /* already gone */ }
    this.killTimer = setTimeout(() => {
      try { this.child.kill('SIGKILL'); } catch { /* already gone */ }
    }, this.killGraceMs);
    unrefSafe(this.killTimer);
  }

  /* ----------------------- internals ----------------------------- */

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      // Idle kill (spec §4.1): dispose + emit closed. Invisible to the user —
      // the next send respawns with --resume.
      this.dispose();
      this.emitClosed(null);
    }, this.idleTimeoutMs);
    unrefSafe(this.idleTimer);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private clearKillTimer(): void {
    if (this.killTimer !== undefined) {
      clearTimeout(this.killTimer);
      this.killTimer = undefined;
    }
  }

  private writeFrame(frame: Record<string, unknown>): void {
    try {
      this.child.stdin?.write(JSON.stringify(frame) + '\n');
    } catch {
      /* child died mid-write — the 'close'/'error' handlers report it */
    }
  }

  private handleStdout(chunk: Buffer | string): void {
    this.stdoutBuffer += chunk.toString();
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      this.handleLine(line);
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return; // malformed line: drop silently (spec §5.1)
    }
    const record = asRecord(parsed);
    if (!record) return;
    const event = mapStreamLine(record, this.sessionId);
    if (event) this.emit(event);
  }

  private appendStderr(chunk: Buffer | string): void {
    this.stderrTail = (this.stderrTail + chunk.toString()).slice(-STDERR_TAIL_MAX);
  }

  private handleClose(code: number | null): void {
    this.clearKillTimer();
    this.clearIdleTimer();
    // Flush a final unterminated line in case the CLI exited mid-write.
    if (this.stdoutBuffer.trim()) {
      this.handleLine(this.stdoutBuffer);
      this.stdoutBuffer = '';
    }
    const failed = code !== null && code !== 0;
    this.emitClosed(code, failed ? (this.stderrTail.trim() || `claude exited with code ${code}`) : undefined);
  }

  private handleSpawnError(err: Error): void {
    this.clearKillTimer();
    this.clearIdleTimer();
    this.emitClosed(null, chatErrorMessage(err));
  }

  private emitClosed(code: number | null, error?: string): void {
    if (this.closedEmitted) return;
    this.closedEmitted = true;
    this.emit(error === undefined ? { kind: 'closed', code } : { kind: 'closed', code, error });
  }

  private emit(event: ChatEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch {
        /* a broken listener must never stall the stream */
      }
    }
  }
}

/* ================================================================== */
/*  stream-json line → ChatEvent mapping (defensive, spec §5.1)       */
/* ================================================================== */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mapStreamLine(parsed: Record<string, unknown>, fallbackSessionId: string): ChatEvent | null {
  switch (parsed.type) {
    case 'stream_event':
      return mapStreamEvent(parsed);
    case 'assistant':
      return mapAssistantMessage(parsed);
    case 'result':
      return {
        kind: 'turn-end',
        usage: extractStreamUsage(parsed),
        sessionId: typeof parsed.session_id === 'string' && parsed.session_id
          ? parsed.session_id
          : fallbackSessionId,
      };
    default:
      return null; // unknown type: drop silently (forward-compat)
  }
}

/** `{type:'stream_event'}` wraps a raw API stream event; only text deltas
 *  become `delta` events — every other sub-shape is dropped. */
function mapStreamEvent(parsed: Record<string, unknown>): ChatEvent | null {
  const event = asRecord(parsed.event);
  if (!event || event.type !== 'content_block_delta') return null;
  const delta = asRecord(event.delta);
  if (!delta || delta.type !== 'text_delta' || typeof delta.text !== 'string') return null;
  return { kind: 'delta', text: delta.text };
}

/** `{type:'assistant'}` carries a complete message: join its text blocks and
 *  collapse tool_use blocks into chips. */
function mapAssistantMessage(parsed: Record<string, unknown>): ChatEvent | null {
  const message = asRecord(parsed.message);
  const content = message?.content;
  if (!Array.isArray(content)) return null;

  const texts: string[] = [];
  const toolUses: ChatToolUse[] = [];
  for (const blockRaw of content) {
    const block = asRecord(blockRaw);
    if (!block) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      const inputPreview = previewToolInput(block.input);
      toolUses.push(inputPreview === undefined ? { name: block.name } : { name: block.name, inputPreview });
    }
  }
  const text = texts.join('\n');
  if (!text && toolUses.length === 0) return null;
  return { kind: 'message', text, toolUses };
}

function previewToolInput(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  let json: string | undefined;
  try {
    json = JSON.stringify(input);
  } catch {
    return undefined;
  }
  if (!json || json === '{}') return undefined;
  return json.length > INPUT_PREVIEW_MAX ? json.slice(0, INPUT_PREVIEW_MAX - 1) + '…' : json;
}

/** Same envelope shape as `--output-format json` (see claude-resume.ts). */
function extractStreamUsage(envelope: Record<string, unknown>): SessionChatUsage | undefined {
  const usage = asRecord(envelope.usage);
  const costUsd = typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : undefined;
  const inputTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined;
  const outputTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined;
  if (inputTokens === undefined && outputTokens === undefined && costUsd === undefined) return undefined;
  return { inputTokens, outputTokens, costUsd };
}

function chatErrorMessage(err: Error): string {
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
    return 'The `claude` CLI was not found on PATH. Install Claude Code or set aiEngineerCoach.sessionChat.binPath.';
  }
  return err.message;
}

function unrefSafe(timer: ReturnType<typeof setTimeout>): void {
  (timer as { unref?: () => void }).unref?.();
}

/* ================================================================== */
/*  Module-level registry (per HANDOFF — killed by DashboardPanel on  */
/*  dispose()/reload())                                               */
/* ================================================================== */

/** Insertion order doubles as LRU order: getOrCreate re-inserts on touch. */
const chatRegistry = new Map<string, ClaudeChatProcess>();

/**
 * Return the live process for the session, or spawn one. Enforces the hard
 * cap of 2 concurrent processes by disposing the least-recently-used first.
 * A closed (idle-killed / exited) process is replaced, never reused.
 */
export function getOrCreateChatProcess(opts: ClaudeChatProcessOptions): ClaudeChatProcess {
  const existing = chatRegistry.get(opts.sessionId);
  if (existing) {
    if (!existing.isClosed) {
      // Touch: move to most-recently-used position.
      chatRegistry.delete(opts.sessionId);
      chatRegistry.set(opts.sessionId, existing);
      return existing;
    }
    chatRegistry.delete(opts.sessionId);
  }

  while (chatRegistry.size >= MAX_CHAT_PROCESSES) {
    const lruId = chatRegistry.keys().next().value;
    if (lruId === undefined) break;
    closeChatProcess(lruId);
  }

  const proc = new ClaudeChatProcess(opts);
  chatRegistry.set(opts.sessionId, proc);
  // Self-evict on close so dead entries never count against the cap.
  proc.onEvent((e) => {
    if (e.kind === 'closed' && chatRegistry.get(opts.sessionId) === proc) {
      chatRegistry.delete(opts.sessionId);
    }
  });
  return proc;
}

/** The live (non-closed) process for the session, if any. */
export function getChatProcess(sessionId: string): ClaudeChatProcess | undefined {
  const proc = chatRegistry.get(sessionId);
  return proc && !proc.isClosed ? proc : undefined;
}

/** Dispose and forget one session's process (no-op when absent). */
export function closeChatProcess(sessionId: string): void {
  const proc = chatRegistry.get(sessionId);
  chatRegistry.delete(sessionId);
  proc?.dispose();
}

/** Dispose every live process — called on panel dispose() and reload(). */
export function closeAllChatProcesses(): void {
  // Map deletion during keys() iteration is safe per the ES iteration contract.
  for (const sessionId of chatRegistry.keys()) {
    closeChatProcess(sessionId);
  }
}
