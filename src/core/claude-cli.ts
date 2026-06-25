/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * `claude -p` suggestion engine — pure core, no VS Code dependency.
 *
 * Shells out to the local `claude` binary, headless and sandboxed, to turn a
 * draft prompt + its diagnosed issues + the developer's profile into an
 * improved prompt. Hard constraints:
 *   - `--allowedTools ""` — no tools; this is a pure text transform that can
 *     never touch the filesystem or run commands.
 *   - cwd is a throwaway temp dir, so there is no project to wander into.
 *   - the prompt is piped over stdin (not argv) — safe for large/multiline
 *     drafts and immune to shell quoting (spawn runs with shell:false).
 *   - no `--model` flag: defer to whatever the user's `claude` config resolves.
 *   - a timeout + graceful fallback to deterministic heuristic advice if the
 *     binary is missing, errors, times out, or returns unparseable output.
 */

import { spawn } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ClaudeImproveInput,
  ClaudeImproveResult,
  ClaudeImproveUsage,
} from './types/prompt-studio-types';

const DEFAULT_TIMEOUT_MS = 60_000;

/** Model for the (invisible-to-user) suggestion engine. Haiku keeps the
 *  rewrite fast and cheap; the `haiku` alias always resolves to the latest. */
const DEFAULT_MODEL = 'haiku';

/** Resolves to the captured stdout + exit code, or rejects on spawn/timeout error. */
export type ClaudeRunner = (
  stdin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; binPath: string },
) => Promise<{ stdout: string; code: number | null }>;

export interface ClaudeCliOptions {
  /** Binary to invoke (default `claude`, resolved via PATH). */
  binPath?: string;
  /** Kill the process after this many ms (default 60s). */
  timeoutMs?: number;
  /** Working directory; defaults to a fresh throwaway temp dir. */
  cwd?: string;
  /** Model passed to `--model` (default `haiku`). */
  model?: string;
  /** Injectable process runner — tests pass a fake so nothing is spawned. */
  runner?: ClaudeRunner;
}

const COACH_SYSTEM_PROMPT = [
  'You are a prompt-engineering coach for developers using AI coding agents.',
  'You receive a draft prompt, a list of heuristic issues already detected in it,',
  "and the developer's habitual anti-patterns and context-engineering gaps.",
  'Rewrite the draft into a stronger prompt and explain your reasoning.',
  '',
  'Respond with ONLY a single JSON object — no prose, no markdown fences — with exactly these keys:',
  '  "advice": string[]          // 2-5 specific, actionable tips tailored to this prompt and developer',
  '  "improvedPrompt": string    // the rewritten prompt, ready to copy-paste',
  '  "whatChanged": string[]     // 2-5 short notes on what you changed and why',
  'Do not use any tools. Do not ask questions. Output the JSON object only.',
].join('\n');

/* ================================================================== */
/*  Public API                                                        */
/* ================================================================== */

export async function improvePromptViaClaude(
  input: ClaudeImproveInput,
  opts: ClaudeCliOptions = {},
): Promise<ClaudeImproveResult> {
  const binPath = opts.binPath ?? 'claude';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = opts.model ?? DEFAULT_MODEL;
  const runner = opts.runner ?? defaultClaudeRunner;

  let cwd = opts.cwd;
  let tempDir: string | undefined;
  if (!cwd) {
    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-studio-'));
      cwd = tempDir;
    } catch {
      cwd = os.tmpdir();
    }
  }

  const args = ['-p', '--output-format', 'json', '--model', model, '--allowedTools', '', '--append-system-prompt', COACH_SYSTEM_PROMPT];
  const structuredInput = buildStructuredInput(input);

  try {
    const { stdout, code } = await runner(structuredInput, args, { cwd, timeoutMs, binPath });
    const parsed = parseClaudeOutput(stdout);
    if (!parsed) {
      throw new Error(code === 0 ? 'claude returned no parseable result' : `claude exited with code ${code}`);
    }
    return { ...parsed, source: 'claude' };
  } catch (err) {
    return buildFallback(input, errorMessage(err));
  } finally {
    if (tempDir) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

/* ================================================================== */
/*  Default runner (spawn)                                            */
/* ================================================================== */

/** Shared default runner — also used by `claude-resume.ts` so both `claude -p`
 *  surfaces (Prompt Studio, Session Chat) spawn the binary identically. */
export const defaultClaudeRunner: ClaudeRunner = (stdin, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(opts.binPath, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`claude timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && stdout.trim().length === 0) {
        reject(new Error(stderr.trim() || `claude exited with code ${code}`));
        return;
      }
      resolve({ stdout, code });
    });

    try {
      child.stdin?.write(stdin);
      child.stdin?.end();
    } catch {
      /* if the child already died, 'error'/'close' handlers cover it */
    }
  });

/* ================================================================== */
/*  Input + output shaping                                            */
/* ================================================================== */

function buildStructuredInput(input: ClaudeImproveInput): string {
  const issues = input.issues.length > 0
    ? input.issues.map(i => `- ${i.ruleName}: ${i.suggestion}`).join('\n')
    : '- (no rule-based issues detected)';
  const patterns = input.profile.topPatterns.length > 0
    ? input.profile.topPatterns.map(p => `- ${p.name} (${p.occurrences}x in history)`).join('\n')
    : '- (no history available)';
  const gaps = input.profile.contextGaps.length > 0
    ? input.profile.contextGaps.map(g => `- ${g}`).join('\n')
    : '- (none detected)';

  return [
    'Improve the following prompt for an AI coding agent.',
    '',
    `Detected intent: ${input.profile.intent}`,
    '',
    'Heuristic issues found in this prompt:',
    issues,
    '',
    "Developer's habitual anti-patterns (from history):",
    patterns,
    '',
    "Developer's context-engineering gaps:",
    gaps,
    '',
    'Draft prompt to improve:',
    '"""',
    input.text,
    '"""',
  ].join('\n');
}

/** Extract the first balanced JSON object from a string, or null. Tolerates
 *  leading/trailing logs and markdown fences around the JSON. */
export function extractJsonObject(raw: string): string | null {
  const text = raw.replaceAll(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

interface ParsedClaude {
  advice: string[];
  improvedPrompt: string;
  whatChanged: string[];
  usage?: ClaudeImproveUsage;
}

/** Parse the `claude -p --output-format json` envelope and the JSON object the
 *  coach was asked to return inside its `result` field. */
function parseClaudeOutput(stdout: string): ParsedClaude | null {
  const envelopeText = extractJsonObject(stdout);
  if (!envelopeText) return null;

  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(envelopeText) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (envelope.is_error === true) return null;

  // The assistant's text lives in `result` (string). Older/edge shapes may put
  // the JSON object directly at the top level — handle both.
  const resultText = typeof envelope.result === 'string' ? envelope.result : envelopeText;
  const innerText = extractJsonObject(resultText);
  if (!innerText) return null;

  let inner: Record<string, unknown>;
  try {
    inner = JSON.parse(innerText) as Record<string, unknown>;
  } catch {
    return null;
  }

  const improvedPrompt = typeof inner.improvedPrompt === 'string' ? inner.improvedPrompt : '';
  if (!improvedPrompt.trim()) return null;

  return {
    advice: toStringArray(inner.advice),
    improvedPrompt,
    whatChanged: toStringArray(inner.whatChanged),
    usage: extractUsage(envelope),
  };
}

function extractUsage(envelope: Record<string, unknown>): ClaudeImproveUsage | undefined {
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

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v.trim()) return [v];
  return [];
}

/* ================================================================== */
/*  Heuristic fallback                                                */
/* ================================================================== */

function buildFallback(input: ClaudeImproveInput, error: string): ClaudeImproveResult {
  const advice = input.issues.length > 0
    ? input.issues.map(i => i.suggestion)
    : ['Add concrete context, explicit constraints, and the expected output format to your prompt.'];
  return {
    advice,
    improvedPrompt: synthesizeImprovedPrompt(input),
    whatChanged: input.issues.map(i => `Addresses: ${i.ruleName}`),
    source: 'fallback',
    error,
  };
}

/** A structured scaffold built deterministically from the draft — used when
 *  `claude` is unavailable so the page still offers a concrete next step. */
function synthesizeImprovedPrompt(input: ClaudeImproveInput): string {
  const task = input.text.trim();
  if (!task) return '';
  return [
    `Task: ${task}`,
    '',
    'Context:',
    '- <relevant files, modules, or prior decisions>',
    '',
    'Constraints:',
    '- <approach to use or avoid; libraries; limits>',
    '',
    'Expected output:',
    '- <format, tests, or acceptance criteria>',
  ].join('\n');
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // Surface a friendly message for the common "binary not installed" case.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'The `claude` CLI was not found on PATH — showing heuristic advice instead.';
    }
    return err.message;
  }
  return String(err);
}
