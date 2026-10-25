/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Atlas runner — pure core, no VS Code dependency (spec §4.2).
 *
 * Drives one headless Archify run:
 *
 *   claude -p --output-format stream-json --verbose
 *     --add-dir <workspaceRoot>
 *     --allowedTools "<scoped allow-list>" --permission-mode acceptEdits
 *     [--model <m>] [--resume <claudeSessionId>]
 *     "<prompt>"
 *
 * Decisions that came out of docs/spikes/archify-2026-10.md:
 *   - cwd is the per-map run directory inside globalStorage (Archify requires
 *     `meta.output` relative to cwd and defaults to `.archify/` *inside the
 *     repo* otherwise); `--add-dir` keeps Read/Glob/Grep able to see the repo.
 *   - Bash is allow-listed with Claude Code's prefix syntax (`Bash(cmd:*)`),
 *     absolute skill paths for both `~/.agents` and `~/.claude` spellings, plus
 *     the read-only git / nl / wc / ls commands Archify's own instructions
 *     make the model run. Never unrestricted Bash.
 *   - stream-json `tool_use` blocks become progress events; unknown lines are
 *     dropped (same posture as claude-chat-process.ts).
 *   - shutdown escalates SIGTERM → 3 s → SIGKILL; default timeout 10 min.
 */

import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type {
  AtlasEligibility,
  AtlasGenerateParams,
  AtlasMapKind,
  AtlasMapMeta,
  AtlasProgressEvent,
  AtlasScopeEstimate,
} from './types/atlas-types';

/* ================================================================== */
/*  Eligibility                                                       */
/* ================================================================== */

export interface AtlasEligibilityInput {
  /** `aiEngineerCoach.atlas.enabled` */
  featureEnabled: boolean;
  workspaceRoot?: string;
  workspaceTrusted: boolean;
  /** `claude --version` output, or null when the probe failed. */
  cliVersion: string | null;
  /** Resolved Archify skill dir, or null when not installed. */
  skillPath: string | null;
  consented: boolean;
}

export const MIN_CLAUDE_MAJOR = 2;

export function parseClaudeMajor(version: string | null): number | null {
  const m = version?.match(/(\d+)\.(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Ordered: feature-disabled → no-workspace → workspace-untrusted → cli-missing
 *  → cli-too-old → skill-missing → consent-missing (spec §4.2). */
export function evaluateAtlasEligibility(input: AtlasEligibilityInput): AtlasEligibility {
  if (!input.featureEnabled) {
    return { eligible: false, reason: 'feature-disabled', detail: 'Atlas is off. Enable aiEngineerCoach.atlas.enabled in Settings.' };
  }
  if (!input.workspaceRoot) {
    return { eligible: false, reason: 'no-workspace', detail: 'Open a folder or workspace to map it.' };
  }
  const base = { workspaceRoot: input.workspaceRoot };
  if (!input.workspaceTrusted) {
    return { eligible: false, reason: 'workspace-untrusted', detail: 'Atlas runs the Claude CLI against this folder, which Restricted Mode does not allow. Trust the workspace first.', ...base };
  }
  if (!input.cliVersion) {
    return { eligible: false, reason: 'cli-missing', detail: 'The `claude` CLI was not found. Install Claude Code (https://claude.com/claude-code) or point aiEngineerCoach.sessionChat.binPath at the binary.', ...base };
  }
  const major = parseClaudeMajor(input.cliVersion);
  if (major !== null && major < MIN_CLAUDE_MAJOR) {
    return { eligible: false, reason: 'cli-too-old', detail: `Claude CLI ${input.cliVersion.trim()} is too old — Atlas needs version ${MIN_CLAUDE_MAJOR} or newer (stream-json + skills).`, ...base, cliVersion: input.cliVersion };
  }
  if (!input.skillPath) {
    return { eligible: false, reason: 'skill-missing', detail: 'The Archify skill is not installed. Run `npx skills add tt-a1i/archify -g` (needs Node ≥ 22.2).', ...base, cliVersion: input.cliVersion };
  }
  if (!input.consented) {
    return { eligible: false, reason: 'consent-missing', detail: 'Enable Claude-powered features to generate maps.', ...base, cliVersion: input.cliVersion, skillPath: input.skillPath };
  }
  return { eligible: true, ...base, cliVersion: input.cliVersion, skillPath: input.skillPath };
}

/** `~/.agents/skills/archify` (skills CLI install root) or the
 *  `~/.claude/skills/archify` symlink Claude Code resolves it through. */
export function resolveArchifySkillPath(home = process.env.HOME || process.env.USERPROFILE || ''): string | null {
  for (const candidate of archifySkillCandidates(home)) {
    try {
      if (fs.existsSync(path.join(candidate, 'bin', 'archify.mjs'))) return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

export function archifySkillCandidates(home: string): string[] {
  if (!home) return [];
  return [
    path.join(home, '.agents', 'skills', 'archify'),
    path.join(home, '.claude', 'skills', 'archify'),
  ];
}

export function probeClaudeVersion(binPath: string): string | null {
  try {
    const res = spawnSync(binPath, ['--version'], { timeout: 5_000, encoding: 'utf-8' });
    return res.status === 0 ? (res.stdout || '').trim() : null;
  } catch {
    return null;
  }
}

/* ================================================================== */
/*  Scope estimate                                                    */
/* ================================================================== */

const SCOPE_IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', '.next', '.venv', 'venv', '__pycache__', '.archify', 'coverage']);
const SCOPE_MAX_FILES = 20_000;

export function scopeHint(fileCount: number): AtlasScopeEstimate['hint'] {
  return fileCount < 300 ? 'small' : fileCount < 2000 ? 'medium' : 'large';
}

/** Tracked files via `git ls-files`, else an fs walk with an ignore list. */
export async function estimateAtlasScope(workspaceRoot: string): Promise<AtlasScopeEstimate> {
  let files: string[] | null = null;
  try {
    const res = spawnSync('git', ['-C', workspaceRoot, 'ls-files', '-z'], { encoding: 'utf-8', timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });
    if (res.status === 0) files = res.stdout.split('\0').filter(Boolean).slice(0, SCOPE_MAX_FILES);
  } catch { /* git missing */ }
  if (!files) files = walkFiles(workspaceRoot);

  let approxBytes = 0;
  const stats = await Promise.allSettled(files.map(f => fs.promises.stat(path.join(workspaceRoot, f))));
  for (const s of stats) if (s.status === 'fulfilled') approxBytes += s.value.size;
  return { fileCount: files.length, approxBytes, hint: scopeHint(files.length) };
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [''];
  while (stack.length && out.length < SCOPE_MAX_FILES) {
    const rel = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SCOPE_IGNORE_DIRS.has(e.name)) stack.push(path.join(rel, e.name));
      } else if (e.isFile()) {
        out.push(path.join(rel, e.name));
      }
    }
  }
  return out;
}

/* ================================================================== */
/*  Command construction                                              */
/* ================================================================== */

export const ATLAS_OUTPUT_BASENAME = 'map.html';

/** Scoped allow-list (spike §1). `skillPaths` should include every spelling
 *  Claude may use (both `~/.agents` and `~/.claude`). */
export function buildAtlasAllowedTools(skillPaths: string[], repoRoot: string): string {
  const tools = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Skill'];
  for (const skill of skillPaths) tools.push(`Bash(node ${path.join(skill, 'bin', 'archify.mjs')}:*)`);
  for (const sub of ['rev-parse', 'remote get-url', 'status', 'ls-files', 'log']) {
    tools.push(`Bash(git ${sub}:*)`, `Bash(git -C ${repoRoot} ${sub}:*)`);
  }
  tools.push('Bash(nl:*)', 'Bash(wc:*)', 'Bash(ls:*)');
  return tools.join(',');
}

export interface AtlasPromptContext {
  outDir: string;
  /** Relative to outDir — `map.html` for a fresh map, `map-<id>.html` for a refinement. */
  outputName: string;
  repoRoot: string;
  repoName: string;
}

export function buildAtlasPrompt(params: AtlasGenerateParams, ctx: AtlasPromptContext): string {
  const outPath = path.join(ctx.outDir, ctx.outputName);
  const common = [
    `Your working directory is ${ctx.outDir}. Keep candidate files and receipts there.`,
    `Set meta.output to the relative path ${ctx.outputName} and run finalize with --repo-root ${ctx.repoRoot}, so the final standalone HTML lands at exactly ${outPath}.`,
    `Do not write any file into the repository itself. Use \`git -C ${ctx.repoRoot}\` for git commands; do not cd into the repository.`,
    'Use link_mode local-only unless the origin is a public GitHub/GitLab HTTPS URL.',
  ];

  if (params.kind === 'explainer') {
    const excerpts = (params.excerpts ?? []).slice(0, 12).map((e, i) => `--- excerpt ${i + 1} ---\n${e}`).join('\n');
    return [
      `Use Archify in explainer mode to answer, as one page, the question: "What did Claude session ${params.sourceSessionId ?? ''} change in the repository at ${ctx.repoRoot} ("${ctx.repoName}"), and why?"`,
      'Put the conclusion first, then structured panels; include a native diagram of the touched components where it helps. Cite the pinned excerpts below as evidence.',
      ...common,
      excerpts ? `Pinned excerpts (diffs from the session):\n${excerpts}` : '',
    ].filter(Boolean).join('\n');
  }

  if (params.baseMapId && params.instruction) {
    return [
      `Refine the architecture diagram you produced earlier for the repository at ${ctx.repoRoot} ("${ctx.repoName}").`,
      `Instruction: ${params.instruction}`,
      `Write the updated standalone HTML as a new file: set meta.output to ${ctx.outputName} and rerun finalize so it lands at exactly ${outPath}. Keep the earlier HTML unchanged.`,
      ...common.slice(2),
    ].join('\n');
  }

  const lines = [
    `Use Archify to map the repository at ${ctx.repoRoot} ("${ctx.repoName}") as a source-backed architecture diagram.`,
    ...common,
  ];
  if (params.kind === 'session-overlay' && params.highlightFiles?.length) {
    const list = params.highlightFiles.slice(0, 60).map(f => `  - ${f}`).join('\n');
    lines.push(
      `Highlight these files as "changed in session ${params.sourceSessionId ?? ''}": give the components that own them a distinct tag/badge and mention the session in a card.`,
      list,
    );
    if (params.baseMapId) lines.splice(0, 1, `Starting from the diagram you produced earlier, produce a variant of it for the repository at ${ctx.repoRoot} ("${ctx.repoName}").`);
  }
  return lines.join('\n');
}

export function buildAtlasArgs(opts: {
  prompt: string;
  allowedTools: string;
  repoRoot: string;
  model?: string;
  resumeSessionId?: string;
}): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--add-dir', opts.repoRoot,
    '--allowedTools', opts.allowedTools,
    '--permission-mode', 'acceptEdits',
  ];
  if (opts.model && opts.model.trim()) args.push('--model', opts.model.trim());
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
  args.push(opts.prompt);
  return args;
}

/* ================================================================== */
/*  Run                                                               */
/* ================================================================== */

/** The slice of ChildProcess this module touches — tests fake exactly this. */
export interface AtlasChildLike {
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

export type AtlasSpawnFn = (binPath: string, args: string[], opts: { cwd: string }) => AtlasChildLike;

const defaultSpawn: AtlasSpawnFn = (binPath, args, opts) =>
  spawn(binPath, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });

export interface RunAtlasOptions {
  /** Absolute workspace root (repo). */
  repoRoot: string;
  repoName: string;
  /** Per-map run directory (cwd); created if missing. */
  outDir: string;
  /** `map.html` or `map-<id>.html` (relative to outDir). */
  outputName: string;
  /** Every spelling of the Archify skill dir to allow. */
  skillPaths: string[];
  binPath?: string;
  timeoutMs?: number;
  model?: string;
  /** L3: resume the base map's Claude session. */
  resumeSessionId?: string;
  spawnFn?: AtlasSpawnFn;
  killGraceMs?: number;
  onEvent?: (e: AtlasProgressEvent) => void;
}

export interface AtlasRunResult {
  /** Fields the store fills in later: workspaceHash, headSha, dirty flags. */
  map: Pick<AtlasMapMeta, 'id' | 'createdAt' | 'title' | 'kind' | 'htmlPath' | 'claudeSessionId' | 'model' | 'durationMs' | 'costUsd' | 'sourceSessionId' | 'baseMapId' | 'instruction' | 'relocatedFrom'>;
}

export type AtlasRunOutcome = AtlasRunResult | { error: string; stderrTail?: string; cancelled?: boolean };

export const DEFAULT_ATLAS_TIMEOUT_MS = 600_000;
const SIGKILL_GRACE_MS = 3_000;
const STDERR_TAIL_MAX = 4_000;
const TOOL_SUMMARY_MAX = 140;

export function newAtlasMapId(now = Date.now()): string {
  return `${now}-${Math.random().toString(36).slice(2, 6)}`;
}

export function atlasMapTitle(params: AtlasGenerateParams): string {
  if (params.kind === 'explainer') return `Session ${shortId(params.sourceSessionId)} explained`;
  if (params.kind === 'session-overlay') return `Session ${shortId(params.sourceSessionId)} overlay`;
  if (params.baseMapId && params.instruction) return params.instruction.length > 48 ? params.instruction.slice(0, 45) + '…' : params.instruction;
  return 'Full repository';
}

function shortId(id?: string): string {
  return id ? id.slice(0, 8) : '?';
}

export function runAtlas(
  params: AtlasGenerateParams,
  opts: RunAtlasOptions,
  mapId = newAtlasMapId(),
): { promise: Promise<AtlasRunOutcome>; cancel(): void } {
  const emit = (e: AtlasProgressEvent): void => { try { opts.onEvent?.(e); } catch { /* listener bug must not kill the run */ } };
  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_ATLAS_TIMEOUT_MS;
  const killGrace = opts.killGraceMs ?? SIGKILL_GRACE_MS;

  try {
    fs.mkdirSync(opts.outDir, { recursive: true });
  } catch (err) {
    const message = `Cannot create run directory: ${err instanceof Error ? err.message : String(err)}`;
    emit({ kind: 'error', message });
    return { promise: Promise.resolve({ error: message }), cancel() { /* nothing started */ } };
  }

  const prompt = buildAtlasPrompt(params, { outDir: opts.outDir, outputName: opts.outputName, repoRoot: opts.repoRoot, repoName: opts.repoName });
  const args = buildAtlasArgs({
    prompt,
    allowedTools: buildAtlasAllowedTools(opts.skillPaths, opts.repoRoot),
    repoRoot: opts.repoRoot,
    model: opts.model,
    resumeSessionId: opts.resumeSessionId,
  });

  let child: AtlasChildLike;
  try {
    child = (opts.spawnFn ?? defaultSpawn)(opts.binPath || 'claude', args, { cwd: opts.outDir });
  } catch (err) {
    const message = spawnErrorMessage(err);
    emit({ kind: 'error', message });
    return { promise: Promise.resolve({ error: message }), cancel() { /* nothing started */ } };
  }

  let stdoutBuffer = '';
  let stderrTail = '';
  let cancelled = false;
  let timedOut = false;
  let settled = false;
  let claudeSessionId: string | undefined;
  let model: string | undefined = opts.model?.trim() || undefined;
  let resultIsError: string | undefined;
  let costUsd: number | undefined;
  let durationMs: number | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  const killEscalating = (): void => {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, killGrace);
    (killTimer as { unref?: () => void }).unref?.();
  };

  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    emit({ kind: 'status', text: `Timed out after ${Math.round(timeoutMs / 60_000)} min — stopping.` });
    killEscalating();
  }, timeoutMs);
  (timeoutTimer as { unref?: () => void }).unref?.();

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch { return; }
    if (!isRecord(parsed)) return;
    if (typeof parsed.session_id === 'string' && parsed.session_id) claudeSessionId = parsed.session_id;

    if (parsed.type === 'system' && parsed.subtype === 'init') {
      // Prefer the CLI's resolved model id over the alias we passed in.
      if (typeof parsed.model === 'string') model = parsed.model;
      emit({ kind: 'status', text: `Claude session started${model ? ` (${model})` : ''}` });
      return;
    }
    if (parsed.type === 'assistant') {
      const message = isRecord(parsed.message) ? parsed.message : undefined;
      if (typeof message?.model === 'string' && !model) model = message.model;
      const content = Array.isArray(message?.content) ? message.content : [];
      for (const raw of content) {
        if (!isRecord(raw)) continue;
        if (raw.type === 'tool_use' && typeof raw.name === 'string') {
          emit({ kind: 'tool', name: raw.name, summary: summarizeToolInput(raw.name, raw.input) });
        } else if (raw.type === 'text' && typeof raw.text === 'string' && raw.text.trim()) {
          emit({ kind: 'status', text: firstLine(raw.text) });
        }
      }
      return;
    }
    if (parsed.type === 'result') {
      if (typeof parsed.total_cost_usd === 'number') costUsd = parsed.total_cost_usd;
      if (typeof parsed.duration_ms === 'number') durationMs = parsed.duration_ms;
      if (parsed.is_error === true) {
        resultIsError = typeof parsed.result === 'string' && parsed.result.trim() ? parsed.result.trim() : 'claude reported an error.';
      }
    }
  };

  child.stdout?.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    let nl = stdoutBuffer.indexOf('\n');
    while (nl >= 0) {
      handleLine(stdoutBuffer.slice(0, nl));
      stdoutBuffer = stdoutBuffer.slice(nl + 1);
      nl = stdoutBuffer.indexOf('\n');
    }
  });
  child.stderr?.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_MAX);
  });

  const promise = new Promise<AtlasRunOutcome>((resolve) => {
    const finish = (outcome: AtlasRunOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve(outcome);
    };

    child.on('error', (err: Error) => {
      const message = spawnErrorMessage(err);
      emit({ kind: 'error', message });
      finish({ error: message });
    });

    child.on('close', (code: number | null) => {
      if (stdoutBuffer.trim()) { handleLine(stdoutBuffer); stdoutBuffer = ''; }
      if (cancelled) {
        emit({ kind: 'cancelled' });
        finish({ error: 'cancelled', cancelled: true });
        return;
      }
      if (timedOut) {
        const message = `Atlas run exceeded ${Math.round(timeoutMs / 60_000)} minutes and was stopped.`;
        emit({ kind: 'error', message, stderrTail: stderrTail.trim() || undefined });
        finish({ error: message, stderrTail: stderrTail.trim() || undefined });
        return;
      }

      const expected = path.join(opts.outDir, opts.outputName);
      const located = locateOutput(expected, opts.outDir, opts.repoRoot, startedAt);
      if (!located.path) {
        const message = resultIsError
          ?? (code !== null && code !== 0 ? `claude exited with code ${code}` : located.reason ?? 'Archify did not produce an HTML file.');
        emit({ kind: 'error', message, stderrTail: stderrTail.trim() || undefined });
        finish({ error: message, stderrTail: stderrTail.trim() || undefined });
        return;
      }
      if (located.relocatedFrom) {
        emit({ kind: 'status', text: `Archify ignored the output path; moved ${path.basename(located.relocatedFrom)}` });
      }

      const map: AtlasRunResult['map'] = {
        id: mapId,
        createdAt: startedAt,
        title: atlasMapTitle(params),
        kind: params.kind,
        htmlPath: located.path,
        claudeSessionId,
        model,
        durationMs: durationMs ?? Date.now() - startedAt,
        costUsd,
        sourceSessionId: params.sourceSessionId,
        baseMapId: params.baseMapId,
        instruction: params.instruction,
        relocatedFrom: located.relocatedFrom,
      };
      finish({ map });
    });
  });

  return {
    promise,
    cancel() {
      if (settled || cancelled) return;
      cancelled = true;
      emit({ kind: 'status', text: 'Cancelling…' });
      killEscalating();
    },
  };
}

/* ================================================================== */
/*  Output hunt (spec §4.3)                                           */
/* ================================================================== */

/**
 * Prefer the requested path. Otherwise look for exactly one `*.html` newer
 * than the run start in the run dir, then in the repo (depth ≤ 2, skipping
 * node_modules/.git — but *including* Archify's default `.archify/` folder)
 * and move it to the expected path. Zero or many candidates → no path.
 */
export function locateOutput(
  expected: string,
  outDir: string,
  repoRoot: string,
  startedAt: number,
): { path?: string; relocatedFrom?: string; reason?: string } {
  if (isFreshFile(expected, startedAt)) return { path: expected };

  const candidates = new Set<string>();
  for (const f of listHtml(outDir, 2, startedAt)) if (path.resolve(f) !== path.resolve(expected)) candidates.add(f);
  if (candidates.size === 0) {
    for (const f of listHtml(repoRoot, 2, startedAt)) candidates.add(f);
    const archifyDir = path.join(repoRoot, '.archify');
    for (const f of listHtml(archifyDir, 3, startedAt)) candidates.add(f);
  }
  if (candidates.size === 1) {
    const [found] = candidates;
    try {
      fs.mkdirSync(path.dirname(expected), { recursive: true });
      fs.renameSync(found, expected);
    } catch {
      try { fs.copyFileSync(found, expected); fs.unlinkSync(found); } catch (err) {
        return { reason: `Found ${found} but could not move it: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    return { path: expected, relocatedFrom: found };
  }
  if (candidates.size > 1) return { reason: `Archify ignored the output path and left ${candidates.size} HTML files; cannot pick one.` };
  return { reason: 'Archify finished without writing an HTML file. Check the log above — the render step may have been denied.' };
}

function isFreshFile(file: string, startedAt: number): boolean {
  try {
    const st = fs.statSync(file);
    return st.isFile() && st.mtimeMs >= startedAt - 1_000;
  } catch {
    return false;
  }
}

function listHtml(root: string, maxDepth: number, startedAt: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth && e.name !== 'node_modules' && e.name !== '.git') walk(full, depth + 1);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.html') && isFreshFile(full, startedAt)) {
        out.push(full);
      }
    }
  };
  walk(root, 0);
  return out;
}

/* ================================================================== */
/*  helpers                                                           */
/* ================================================================== */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0];
  return line.length > TOOL_SUMMARY_MAX ? line.slice(0, TOOL_SUMMARY_MAX - 1) + '…' : line;
}

export function summarizeToolInput(name: string, input: unknown): string {
  if (!isRecord(input)) return '';
  const pick = (...keys: string[]): string => {
    for (const k of keys) if (typeof input[k] === 'string' && input[k]) return input[k];
    return '';
  };
  let summary: string;
  switch (name) {
    case 'Bash': summary = pick('command'); break;
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': summary = pick('file_path'); break;
    case 'Glob': case 'Grep': summary = pick('pattern'); break;
    case 'Skill': summary = pick('skill'); break;
    default: summary = pick('file_path', 'command', 'pattern', 'path');
  }
  return summary.length > TOOL_SUMMARY_MAX ? summary.slice(0, TOOL_SUMMARY_MAX - 1) + '…' : summary;
}

function spawnErrorMessage(err: unknown): string {
  if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
    return 'The `claude` CLI was not found on PATH. Install Claude Code or set aiEngineerCoach.sessionChat.binPath.';
  }
  return err instanceof Error ? err.message : String(err);
}

export function isAtlasMapKind(value: unknown): value is AtlasMapKind {
  return value === 'full' || value === 'session-overlay' || value === 'explainer';
}
