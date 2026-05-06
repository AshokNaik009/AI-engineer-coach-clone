/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Base class for analyzer modules -- provides shared filtering logic */

import { Session, SessionRequest, DateFilter } from './types';
import { toDateStr } from './helpers';

export class AnalyzerBase {
  protected readonly sessions: Session[];
  protected readonly editLocIndex: Map<string, Map<string, number>>;
  protected readonly requestSessionMap: Map<SessionRequest, Session>;

  constructor(sessions: Session[], editLocIndex: Map<string, Map<string, number>>, sharedMap?: Map<SessionRequest, Session>) {
    this.sessions = sessions;
    this.editLocIndex = editLocIndex;
    if (sharedMap) {
      this.requestSessionMap = sharedMap;
    } else {
      this.requestSessionMap = AnalyzerBase.buildRequestSessionMap(sessions);
    }
  }

  static buildRequestSessionMap(sessions: Session[]): Map<SessionRequest, Session> {
    const map = new Map<SessionRequest, Session>();
    for (const s of sessions) {
      for (const r of s.requests) {
        map.set(r, s);
      }
    }
    return map;
  }

  protected matchesWorkspaceFilter(session: Session, workspaceId?: string): boolean {
    if (!workspaceId) return true;
    return session.workspaceId === workspaceId || session.workspaceName === workspaceId;
  }

  protected filter(f?: DateFilter): SessionRequest[] {
    const reqs: SessionRequest[] = [];
    for (const s of this.sessions) {
      if (!this.matchesWorkspaceFilter(s, f?.workspaceId)) continue;
      if (f?.harness && s.harness !== f.harness) continue;
      for (const r of s.requests) {
        if (r.timestamp == null || r.timestamp <= 0) continue;
        if (f?.fromDate && toDateStr(r.timestamp) < f.fromDate) continue;
        if (f?.toDate && toDateStr(r.timestamp) > f.toDate) continue;
        reqs.push(r);
      }
    }
    return reqs;
  }

  /** Total LoC for a request: code-block lines + agent-mode edit lines. */
  protected requestLoc(r: SessionRequest): number {
    let loc = r.aiCode.reduce((s, b) => s + b.loc, 0);
    const eMap = this.editLocIndex.get(r.requestId);
    if (eMap) for (const v of eMap.values()) loc += v;
    return loc;
  }

  protected filteredSessions(f?: DateFilter): Session[] {
    return this.sessions.filter(s => {
      if (!this.matchesWorkspaceFilter(s, f?.workspaceId)) return false;
      if (f?.harness && s.harness !== f.harness) return false;
      const ts = s.lastMessageDate || s.creationDate;
      if (ts == null) return false;
      const d = toDateStr(ts);
      if (f?.fromDate && d < f.fromDate) return false;
      if (f?.toDate && d > f.toDate) return false;
      return true;
    });
  }
}
