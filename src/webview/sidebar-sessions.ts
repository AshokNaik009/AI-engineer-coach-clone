/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Native sidebar "Sessions" tree — Claude sessions grouped by project, newest
 * first, click to continue in the dashboard's Session Chat page. Mirrors the
 * official Claude extension's Sessions panel, but with explicit ineligibility
 * markers instead of silently stalling on worktree-born sessions.
 *
 * Data source: the already-parsed sessions held by the dashboard's panel cache
 * when available; otherwise a lightweight direct scan of ~/.claude/projects
 * that reads only file heads + mtimes (never a full parse). */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { listClaudeSessionsLight } from '../core/claude-resume';
import { panelCache } from './panel-cache';

const PER_PROJECT_CAP = 20;
const LABEL_MAX_CHARS = 50;

interface SessionRow {
  sessionId: string;
  label: string;
  lastActiveMs: number;
  cwd?: string;
  /** cwd unknown or deleted — still listed (discoverability over purity),
   *  but flagged; clicking shows the chat page's ineligible card. */
  warning?: string;
}

interface ProjectGroup {
  name: string;
  total: number;
  rows: SessionRow[];
}

export type SessionNode =
  | { kind: 'project'; group: ProjectGroup }
  | { kind: 'session'; row: SessionRow; projectName: string }
  | { kind: 'more'; count: number };

function truncateLabel(text: string): string {
  const flat = text.replaceAll(/\s+/g, ' ').trim();
  if (!flat) return '(no prompt)';
  return flat.length > LABEL_MAX_CHARS ? `${flat.slice(0, LABEL_MAX_CHARS - 1)}…` : flat;
}

function relativeTime(ms: number): string {
  if (!ms) return '';
  const delta = Date.now() - ms;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function cwdWarning(cwd: string | undefined): string | undefined {
  if (!cwd) return 'No working directory recorded — the CLI cannot resume this session.';
  try {
    if (!fs.existsSync(cwd)) return `Project directory no longer exists: ${cwd}`;
  } catch {
    /* treat unreadable as fine; the chat page re-checks server-side */
  }
  return undefined;
}

function buildGroupsFromPanelCache(): ProjectGroup[] | null {
  const result = panelCache.result;
  if (!result) return null;
  const byProject = new Map<string, SessionRow[]>();
  for (const session of result.sessions) {
    if (session.harness !== 'Claude') continue;
    const cwd = session.workspaceRootPath;
    const name = cwd ? path.basename(cwd) : session.workspaceName || '(unknown project)';
    const rows = byProject.get(name) ?? [];
    rows.push({
      sessionId: session.sessionId,
      label: truncateLabel(session.requests[0]?.messageText ?? ''),
      lastActiveMs: session.lastMessageDate ?? session.creationDate ?? 0,
      cwd,
      warning: cwdWarning(cwd),
    });
    byProject.set(name, rows);
  }
  const groups: ProjectGroup[] = [];
  for (const [name, rows] of byProject) {
    rows.sort((a, b) => b.lastActiveMs - a.lastActiveMs);
    groups.push({ name, total: rows.length, rows: rows.slice(0, PER_PROJECT_CAP) });
  }
  groups.sort((a, b) => (b.rows[0]?.lastActiveMs ?? 0) - (a.rows[0]?.lastActiveMs ?? 0));
  return groups;
}

function buildGroupsFromDirectScan(): ProjectGroup[] {
  return listClaudeSessionsLight(undefined, { perProjectCap: PER_PROJECT_CAP }).map(project => ({
    name: project.projectName,
    total: project.totalSessions,
    rows: project.sessions.map(s => ({
      sessionId: s.sessionId,
      label: truncateLabel(s.firstUserText),
      lastActiveMs: s.mtimeMs,
      cwd: s.cwd,
      warning: cwdWarning(s.cwd),
    })),
  }));
}

export class SessionsTreeProvider implements vscode.TreeDataProvider<SessionNode> {
  public static instance: SessionsTreeProvider | undefined;

  private readonly didChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.didChange.event;

  private groups: ProjectGroup[] | undefined;

  constructor() {
    SessionsTreeProvider.instance = this;
  }

  refresh(): void {
    this.groups = undefined;
    this.didChange.fire();
  }

  private ensureGroups(): ProjectGroup[] {
    if (!this.groups) {
      this.groups = buildGroupsFromPanelCache() ?? buildGroupsFromDirectScan();
    }
    return this.groups;
  }

  getChildren(element?: SessionNode): SessionNode[] {
    if (!element) {
      return this.ensureGroups().map(group => ({ kind: 'project', group } as const));
    }
    if (element.kind === 'project') {
      const children: SessionNode[] = element.group.rows.map(row => ({
        kind: 'session', row, projectName: element.group.name,
      } as const));
      const hidden = element.group.total - element.group.rows.length;
      if (hidden > 0) children.push({ kind: 'more', count: hidden });
      return children;
    }
    return [];
  }

  getTreeItem(element: SessionNode): vscode.TreeItem {
    if (element.kind === 'project') {
      const currentName = vscode.workspace.workspaceFolders?.[0]?.name;
      const item = new vscode.TreeItem(
        element.group.name,
        element.group.name === currentName
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = new vscode.ThemeIcon('folder');
      item.description = `${element.group.total}`;
      item.contextValue = 'coachSessionProject';
      return item;
    }

    if (element.kind === 'more') {
      const item = new vscode.TreeItem(`${element.count} more…`, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('ellipsis');
      item.tooltip = 'Older sessions are available from the dashboard\'s Session Chat page.';
      return item;
    }

    const { row } = element;
    const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
    item.description = relativeTime(row.lastActiveMs);
    item.iconPath = new vscode.ThemeIcon(row.warning ? 'warning' : 'comment-discussion');
    item.tooltip = [row.sessionId, row.cwd ?? '(no cwd recorded)', row.warning ?? ''].filter(Boolean).join('\n');
    item.contextValue = 'coachSession';
    item.command = {
      command: 'aiEngineerCoach.continueSession',
      title: 'Continue Session',
      arguments: [row.sessionId],
    };
    return item;
  }
}
