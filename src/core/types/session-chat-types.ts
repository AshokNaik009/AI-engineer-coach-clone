/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Session continuation ("Continue in Coach") wire types — shared between the
 * pure core (`claude-resume.ts`), the RPC layer, and the webview page. */

export type SessionChatIneligibleReason =
  | 'not-claude'
  | 'no-session-file'
  | 'no-cwd'
  | 'cwd-missing'
  | 'recently-active'
  | 'feature-disabled'
  | 'cli-missing';

export interface SessionChatEligibility {
  eligible: boolean;
  /** machine-readable reason when ineligible */
  reason?: SessionChatIneligibleReason;
  detail?: string;          // human-readable explanation for the UI
  sessionFilePath?: string; // absolute path to the .jsonl
  resolvedCwd?: string;     // dir the CLI will be spawned in
}

export interface SessionChatSendParams {
  sessionId: string;        // UUID == jsonl basename
  message: string;          // user's new turn (plain text)
  fork?: boolean;           // true → pass --fork-session (branch, don't append)
  /** Explicit user override for the `recently-active` concurrent-writer
   *  heuristic ("continue anyway"). Never set automatically. */
  ignoreRecentActivity?: boolean;
}

export interface SessionChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface SessionChatTurn {
  reply: string;            // assistant text from envelope `result`
  sessionId: string;        // echoed from envelope — differs from input iff fork
  durationMs?: number;
  usage?: SessionChatUsage;
  error?: string;           // set on failure; reply empty
}

/** One project group from the lightweight `~/.claude/projects` scan used by
 *  the native Sessions tree view when the full parse is not in memory. */
export interface ClaudeProjectListing {
  /** Folder name decoded from the sessions' cwd when readable, else the
   *  encoded project dir name. */
  projectName: string;
  /** Encoded project directory name under ~/.claude/projects. */
  dirName: string;
  /** Total session files in the project dir (may exceed sessions.length). */
  totalSessions: number;
  /** Most recent sessions, newest first, capped per project. */
  sessions: ClaudeSessionListing[];
}

/** One row of the lightweight `~/.claude/projects` scan used by the native
 *  Sessions tree view when the dashboard's full parse is not in memory. */
export interface ClaudeSessionListing {
  sessionId: string;
  filePath: string;
  /** Decoded-from-cwd folder name when readable, else the encoded dir name. */
  projectName: string;
  /** First user prompt text (may be empty when the head of the file holds none). */
  firstUserText: string;
  /** jsonl mtime — proxy for "last active". */
  mtimeMs: number;
  /** cwd recorded in the session file head, when present. */
  cwd?: string;
}

/* ================================================================== */
/*  Phase 2 — live chat (stream-json) events                          */
/* ================================================================== */

/** Permission posture for a live chat process (spec §4.4).
 *  'none' (default) keeps Phase 1's conversation-only `--allowedTools ""`;
 *  'plan' and 'acceptEdits' pass `--permission-mode <mode>` instead. */
export type SessionChatPermissionMode = 'none' | 'plan' | 'acceptEdits';

/** One collapsed tool-activity chip extracted from an assistant message. */
export interface ChatToolUse {
  name: string;
  /** Truncated JSON preview of the tool input, for the chip tooltip. */
  inputPreview?: string;
}

/** Internal event union a live `ClaudeChatProcess` translates raw stream-json
 *  lines into (spec §4.1). Anything the CLI emits that does not map onto one
 *  of these kinds is dropped silently — forward-compat per spec §5.1. */
export type ChatEvent =
  /** Incremental assistant text from `--include-partial-messages`. */
  | { kind: 'delta'; text: string }
  /** A complete assistant message: full text + collapsed tool-use chips. */
  | { kind: 'message'; text: string; toolUses: ChatToolUse[] }
  /** The turn's `result` envelope: usage/cost plus the echoed session id
   *  (differs from the input id only if the CLI forked — drift tripwire). */
  | { kind: 'turn-end'; usage?: SessionChatUsage; sessionId: string }
  /** The child exited (or never spawned). `code` is the exit code when the
   *  process ran; `error` carries spawn/stderr detail on failure. */
  | { kind: 'closed'; code: number | null; error?: string };
