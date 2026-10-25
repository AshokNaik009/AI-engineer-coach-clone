/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Atlas host — the VS Code side of the Atlas RPCs (spec §4.5). Owns the
 * per-workspace store, the single active run, the renderer panel, and the
 * host-only bits (consent, trust, terminals, save dialogs). */

import * as path from 'path';
import * as vscode from 'vscode';
import type { ParseResult } from '../core/parser';
import {
  DEFAULT_ATLAS_TIMEOUT_MS,
  archifySkillCandidates,
  estimateAtlasScope,
  evaluateAtlasEligibility,
  isAtlasMapKind,
  newAtlasMapId,
  probeClaudeVersion,
  resolveArchifySkillPath,
  runAtlas,
} from '../core/atlas-runner';
import { AtlasStore, computeStaleness, gitSnapshot, workspaceHash } from '../core/atlas-store';
import { findClaudeSessionFile } from '../core/claude-resume';
import { readFileChange } from '../core/replay-reader';
import { runtimeDebug } from '../core/runtime-debug';
import type { AtlasEligibility, AtlasGenerateParams, AtlasMapMeta, AtlasProgressEvent, AtlasStaleness } from '../core/types/atlas-types';
import { AtlasMapPanel } from './atlas-panel';
import { hasClaudePoweredConsent } from './consent-state';
import { errorResult } from './panel-shared';

type Push = (msg: Record<string, unknown>) => void;

interface ActiveRun {
  runId: string;
  cancel(): void;
}

const ARCHIFY_INSTALL_COMMAND = 'npx skills add tt-a1i/archify -g';
const CLI_PROBE_FAILURE_TTL_MS = 60_000;
const MAX_EXCERPTS = 12;
const MAX_EXCERPT_CHARS = 4_000;

export class AtlasHost {
  private active: ActiveRun | undefined;
  private cliProbe: { version: string | null; at: number } | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly push: Push,
    private readonly getParseResult: () => ParseResult | undefined,
  ) {}

  dispose(): void {
    this.active?.cancel();
    this.active = undefined;
  }

  async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'atlasEligibility': return this.eligibility();
      case 'atlasEstimate': return this.estimate();
      case 'atlasListMaps': return this.listMaps();
      case 'atlasGenerate': return this.generate(params);
      case 'atlasCancel': return this.cancel(params);
      case 'atlasOpenMap': return this.openMap(params);
      case 'atlasExportMap': return this.exportMap(params);
      case 'atlasDeleteMap': return this.deleteMap(params);
      case 'atlasInstallSkill': return this.installSkill();
      default: return errorResult(`Unknown method: ${method}`);
    }
  }

  /* ---------------- config / environment ---------------- */

  private config(): { enabled: boolean; timeoutMs: number; model: string; maxMaps: number; refineEnabled: boolean; explainEnabled: boolean; binPath: string } {
    const cfg = vscode.workspace.getConfiguration('aiEngineerCoach');
    return {
      enabled: cfg.get<boolean>('atlas.enabled', true),
      timeoutMs: cfg.get<number>('atlas.timeoutMs', DEFAULT_ATLAS_TIMEOUT_MS) || DEFAULT_ATLAS_TIMEOUT_MS,
      model: cfg.get<string>('atlas.model', '') || cfg.get<string>('sessionChat.model', '') || '',
      maxMaps: cfg.get<number>('atlas.maxMaps', 10) || 10,
      refineEnabled: cfg.get<boolean>('atlas.refineEnabled', true),
      explainEnabled: cfg.get<boolean>('atlas.explainEnabled', true),
      binPath: cfg.get<string>('sessionChat.binPath', 'claude') || 'claude',
    };
  }

  private workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private store(root: string): AtlasStore {
    return new AtlasStore(this.context.globalStorageUri.fsPath, root);
  }

  private cliVersion(binPath: string): string | null {
    const now = Date.now();
    if (this.cliProbe && (this.cliProbe.version || now - this.cliProbe.at < CLI_PROBE_FAILURE_TTL_MS)) return this.cliProbe.version;
    const version = probeClaudeVersion(binPath);
    this.cliProbe = { version, at: now };
    return version;
  }

  private eligibility(): AtlasEligibility {
    const cfg = this.config();
    return evaluateAtlasEligibility({
      featureEnabled: cfg.enabled,
      workspaceRoot: this.workspaceRoot(),
      workspaceTrusted: vscode.workspace.isTrusted,
      cliVersion: cfg.enabled ? this.cliVersion(cfg.binPath) : null,
      skillPath: resolveArchifySkillPath(),
      consented: hasClaudePoweredConsent(this.context.globalState),
    });
  }

  /** Every RPC except eligibility is refused while the module is off (§4.7). */
  private disabled(): ReturnType<typeof errorResult> | null {
    return this.config().enabled ? null : errorResult('Atlas is disabled (aiEngineerCoach.atlas.enabled).');
  }

  /* ---------------- read-only RPCs ---------------- */

  private async estimate(): Promise<unknown> {
    const off = this.disabled();
    if (off) return off;
    const root = this.workspaceRoot();
    if (!root) return errorResult('No workspace folder open.');
    return { ...await estimateAtlasScope(root), model: this.config().model || undefined };
  }

  private listMaps(): unknown {
    const off = this.disabled();
    if (off) return off;
    const root = this.workspaceRoot();
    if (!root) return { maps: [], staleness: {} };
    const maps = this.store(root).list();
    const staleness: Record<string, AtlasStaleness> = {};
    for (const m of maps) staleness[m.id] = computeStaleness(root, m);
    return { maps, staleness, activeRunId: this.active?.runId };
  }

  /* ---------------- generate / cancel ---------------- */

  private async generate(raw: Record<string, unknown>): Promise<unknown> {
    const off = this.disabled();
    if (off) return off;
    const eligibility = this.eligibility();
    if (!eligibility.eligible || !eligibility.workspaceRoot || !eligibility.skillPath) {
      return errorResult(eligibility.detail || 'Atlas is not available right now.');
    }
    if (this.active) return errorResult('run-in-progress');

    const params = sanitizeParams(raw);
    const cfg = this.config();
    if ((params.baseMapId || params.kind === 'session-overlay') && !cfg.refineEnabled) {
      return errorResult('Refinement and session overlays need aiEngineerCoach.atlas.refineEnabled.');
    }
    if (params.kind === 'explainer' && !cfg.explainEnabled) {
      return errorResult('"Explain this session" needs aiEngineerCoach.atlas.explainEnabled.');
    }

    const root = eligibility.workspaceRoot;
    const store = this.store(root);
    const base = params.baseMapId ? store.get(params.baseMapId) : undefined;
    if (params.baseMapId && !base) return errorResult('The base map no longer exists.');
    if (base && !base.claudeSessionId) return errorResult('The base map has no Claude session to resume — generate a fresh map instead.');

    // Replay → Atlas: fill the highlight list / excerpts from the parsed session.
    if (params.sourceSessionId) {
      if (params.kind === 'session-overlay' && !params.highlightFiles?.length) {
        params.highlightFiles = this.sessionFiles(params.sourceSessionId, root);
        if (params.highlightFiles.length === 0) return errorResult('That session recorded no file edits inside this workspace.');
      }
      if (params.kind === 'explainer' && !params.excerpts?.length) {
        params.excerpts = await this.sessionExcerpts(params.sourceSessionId);
      }
    }

    const mapId = newAtlasMapId();
    const outDir = base ? path.dirname(base.htmlPath) : store.runDir(mapId);
    const outputName = base ? `map-${mapId}.html` : 'map.html';
    const runId = mapId;
    const emit = (event: AtlasProgressEvent): void => this.push({ type: 'push', topic: 'atlas', runId, event });

    runtimeDebug('atlas', 'generate', `${params.kind} base=${params.baseMapId ?? '-'} model=${cfg.model || 'default'}`);
    const run = runAtlas(params, {
      repoRoot: root,
      repoName: path.basename(root),
      outDir,
      outputName,
      skillPaths: uniq([eligibility.skillPath, ...archifySkillCandidates(process.env.HOME || process.env.USERPROFILE || '')]),
      binPath: cfg.binPath,
      timeoutMs: cfg.timeoutMs,
      model: cfg.model || undefined,
      resumeSessionId: base?.claudeSessionId,
      onEvent: emit,
    }, mapId);
    this.active = { runId, cancel: () => run.cancel() };

    void run.promise.then((outcome) => {
      if (this.active?.runId === runId) this.active = undefined;
      if ('error' in outcome) {
        runtimeDebug('atlas', 'run-failed', outcome.error);
        return; // runner already emitted error/cancelled
      }
      const snap = gitSnapshot(root);
      const meta: AtlasMapMeta = {
        ...outcome.map,
        workspaceHash: workspaceHash(root),
        headSha: snap.headSha,
        dirtyAtGeneration: snap.dirty,
      };
      try {
        store.insert(meta, cfg.maxMaps);
      } catch (err) {
        emit({ kind: 'error', message: `Map generated but could not be indexed: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
      emit({ kind: 'done', map: meta });
      runtimeDebug('atlas', 'run-done', `${meta.id} ${meta.durationMs ?? '?'}ms $${meta.costUsd ?? '?'}`);
    });

    return { runId };
  }

  private cancel(params: Record<string, unknown>): unknown {
    const runId = typeof params.runId === 'string' ? params.runId : '';
    if (!this.active || (runId && this.active.runId !== runId)) return { ok: false };
    this.active.cancel();
    return { ok: true };
  }

  /* ---------------- per-map actions ---------------- */

  /** L2 (editor → node): open the newest full map with `filePath` highlighted. */
  openLatestWithHighlight(filePath: string): { ok: boolean; error?: string } {
    if (!this.config().enabled) return { ok: false, error: 'Atlas is disabled (aiEngineerCoach.atlas.enabled).' };
    const root = this.workspaceRoot();
    if (!root) return { ok: false, error: 'No workspace folder open.' };
    const latest = this.store(root).list().find(m => m.kind === 'full');
    if (!latest) return { ok: false, error: 'No Atlas map exists for this workspace yet — generate one first, then use "Show File in Atlas".' };
    return AtlasMapPanel.show(latest, root, filePath);
  }

  private openMap(params: Record<string, unknown>): unknown {
    const off = this.disabled();
    if (off) return off;
    const root = this.workspaceRoot();
    const mapId = typeof params.mapId === 'string' ? params.mapId : '';
    const meta = root ? this.store(root).get(mapId) : undefined;
    if (!root || !meta) return { ok: false, error: 'Map not found.' };
    const highlight = typeof params.highlightPath === 'string' ? params.highlightPath : undefined;
    return AtlasMapPanel.show(meta, root, highlight);
  }

  private async exportMap(params: Record<string, unknown>): Promise<unknown> {
    const off = this.disabled();
    if (off) return off;
    const root = this.workspaceRoot();
    const mapId = typeof params.mapId === 'string' ? params.mapId : '';
    const store = root ? this.store(root) : undefined;
    const meta = store?.get(mapId);
    if (!root || !store || !meta) return { error: 'Map not found.' };
    const date = new Date(meta.createdAt).toISOString().slice(0, 10);
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(root, 'docs', `atlas-${date}.html`)),
      filters: { HTML: ['html'] },
      saveLabel: 'Export map',
    });
    if (!target) return { cancelled: true };
    try {
      store.exportTo(mapId, target.fsPath);
      return { path: target.fsPath };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  private deleteMap(params: Record<string, unknown>): unknown {
    const off = this.disabled();
    if (off) return off;
    const root = this.workspaceRoot();
    const mapId = typeof params.mapId === 'string' ? params.mapId : '';
    if (!root || !mapId) return { ok: false };
    return { ok: this.store(root).delete(mapId) };
  }

  private installSkill(): unknown {
    const terminal = vscode.window.createTerminal({ name: 'Install Archify skill' });
    terminal.show(true);
    terminal.sendText(ARCHIFY_INSTALL_COMMAND, true);
    return { ok: true };
  }

  /* ---------------- Replay → Atlas helpers ---------------- */

  /** Workspace-relative files a session edited (dedup, inside root only). */
  private sessionFiles(sessionId: string, root: string): string[] {
    const session = this.getParseResult()?.sessions.find(s => s.sessionId === sessionId);
    if (!session) return [];
    const out = new Set<string>();
    for (const r of session.requests) {
      const paths = r.fileChanges?.map(c => c.path) ?? r.editedFiles;
      for (const p of paths) {
        const abs = path.isAbsolute(p) ? p : path.join(session.workspaceRootPath ?? root, p);
        const rel = path.relative(root, abs);
        if (!rel.startsWith('..') && !path.isAbsolute(rel)) out.add(rel.replaceAll('\\', '/'));
      }
    }
    return [...out];
  }

  /** Diff excerpts for the explainer prompt (bounded, Claude sessions only). */
  private async sessionExcerpts(sessionId: string): Promise<string[]> {
    const session = this.getParseResult()?.sessions.find(s => s.sessionId === sessionId);
    if (!session || session.harness !== 'Claude') return [];
    const excerpts: string[] = [];
    for (const r of session.requests) {
      for (const ref of r.fileChanges ?? []) {
        if (excerpts.length >= MAX_EXCERPTS) return excerpts;
        const file = ref.sessionFile ?? findClaudeSessionFile(sessionId);
        if (!file) continue;
        const res = await readFileChange(file, { lineNo: ref.lineNo, tool: ref.tool, toolUseId: ref.toolUseId, path: ref.path }, MAX_EXCERPT_CHARS * 4);
        if ('error' in res || res.truncated) continue;
        const body = res.edits.map(e => `- ${e.oldString.split('\n').slice(0, 20).join('\n- ')}\n+ ${e.newString.split('\n').slice(0, 20).join('\n+ ')}`).join('\n');
        excerpts.push(`${ref.tool} ${ref.path}\nPrompt: ${r.messageText.slice(0, 200)}\n${body}`.slice(0, MAX_EXCERPT_CHARS));
      }
    }
    return excerpts;
  }
}

function sanitizeParams(raw: Record<string, unknown>): AtlasGenerateParams {
  const kind = isAtlasMapKind(raw.kind) ? raw.kind : 'full';
  const params: AtlasGenerateParams = { kind };
  if (Array.isArray(raw.highlightFiles)) params.highlightFiles = raw.highlightFiles.filter((f): f is string => typeof f === 'string').slice(0, 200);
  if (typeof raw.sourceSessionId === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/.test(raw.sourceSessionId)) params.sourceSessionId = raw.sourceSessionId;
  if (typeof raw.baseMapId === 'string' && /^[0-9]+-[a-z0-9]{1,8}$/.test(raw.baseMapId)) params.baseMapId = raw.baseMapId;
  if (typeof raw.instruction === 'string' && raw.instruction.trim()) params.instruction = raw.instruction.trim().slice(0, 2_000);
  if (Array.isArray(raw.excerpts)) params.excerpts = raw.excerpts.filter((e): e is string => typeof e === 'string').slice(0, MAX_EXCERPTS);
  return params;
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
