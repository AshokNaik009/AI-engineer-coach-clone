/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Xcode Copilot Chat SQLite parser
 *
 * Data layout:
 *   ~/.config/github-copilot/xcode/<machine-id>/conversations/<id>.db
 *
 * Uses sqlite3 CLI to query Conversation and Turn tables.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, execFile } from 'child_process';
import { Session, SessionRequest } from './types';
import { assertTrustedPath, extractCodeBlocks, createRequest, createSession, detectDevcontainerFromRequests } from './parser-shared';

/* ---- Directory discovery ---- */

export function findXcodeDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const dirs: string[] = [];
  const xcodeBase = path.join(home, '.config', 'github-copilot', 'xcode');
  if (fs.existsSync(xcodeBase)) dirs.push(xcodeBase);
  return dirs;
}

/* ---- Helpers ---- */

function collectDbFilesFromDir(convDir: string, dbFiles: string[]): void {
  try {
    const files = fs.readdirSync(convDir, { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.db')) continue;
      dbFiles.push(path.join(convDir, f.name));
    }
  } catch (e) {
    console.debug(`No conversations dir in ${path.dirname(convDir)}:`, e instanceof Error ? e.message : e);
  }
}

function findXcodeDbFiles(xcodeBase: string): string[] {
  const dbFiles: string[] = [];
  try {
    const machineIds = fs.readdirSync(xcodeBase, { withFileTypes: true })
      .filter(e => e.isDirectory());
    for (const mid of machineIds) {
      const convDir = path.join(xcodeBase, mid.name, 'conversations');
      collectDbFilesFromDir(convDir, dbFiles);
    }
  } catch (e) {
    console.debug(`Cannot read Xcode dir ${xcodeBase}:`, e instanceof Error ? e.message : e);
  }
  return dbFiles;
}

function sqliteQuery(dbPath: string, sql: string): string {
  assertTrustedPath(dbPath);
  try {
    return execFileSync('sqlite3', ['-json', dbPath, sql], {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (e) {
    console.debug(`sqlite3 query failed on ${dbPath}:`, e instanceof Error ? e.message : e);
    return '';
  }
}

function sqliteQueryAsync(dbPath: string, sql: string): Promise<string> {
  return new Promise(resolve => {
    execFile('sqlite3', ['-json', dbPath, sql], {
      encoding: 'utf-8',
      timeout: 30000,
      killSignal: 'SIGKILL',
      maxBuffer: 50 * 1024 * 1024,
    }, (err, stdout) => {
      if (err) {
        console.debug(`sqlite3 query failed on ${dbPath}:`, err.message);
        resolve('');
      } else {
        resolve(stdout);
      }
    });
  });
}

/** Fast Turn query that avoids sqlite3's slow -json serialization.
 *  Uses raw output with unit separator (\\x1f) between columns and
 *  replaces embedded newlines in data blobs so each row is one line. */
function sqliteQueryTurnsAsync(
  dbPath: string,
  conversationId: string,
): Promise<{ rowID: number; id: string; role: string; data: string; createdAt: number }[]> {
  // Validate conversation ID to prevent SQL injection
  if (!/^[\w-]+$/.test(conversationId)) return Promise.resolve([]);
  const UNIT_SEP = '\x1f';
  const NEWLINE_PLACEHOLDER = '\x1e';
  const sql =
    `SELECT rowID, id, role, replace(data, x'0a', x'1e'), createdAt ` +
    `FROM Turn WHERE conversationID = '${conversationId}' ORDER BY rowID`;
  return new Promise(resolve => {
    execFile('sqlite3', ['-separator', UNIT_SEP, dbPath, sql], {
      encoding: 'utf-8',
      timeout: 30000,
      killSignal: 'SIGKILL',
      maxBuffer: 50 * 1024 * 1024,
    }, (err, stdout) => {
      if (err) {
        console.debug(`sqlite3 turn query failed on ${dbPath}:`, err.message);
        resolve([]);
        return;
      }
      const rows: { rowID: number; id: string; role: string; data: string; createdAt: number }[] = [];
      for (const line of stdout.split('\n')) {
        if (!line) continue;
        const parts = line.split(UNIT_SEP);
        if (parts.length < 5) continue;
        rows.push({
          rowID: Number.parseInt(parts[0], 10),
          id: parts[1],
          role: parts[2],
          data: parts[3].replaceAll(NEWLINE_PLACEHOLDER, '\n'),
          createdAt: Number.parseFloat(parts[4]),
        });
      }
      resolve(rows);
    });
  });
}

/* ---- Main parser ---- */

interface XcodeConversationRow {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
}

interface XcodeTurnRow {
  rowID: number;
  id: string;
  role: string;
  data: string;
  createdAt: number;
}

interface XcodeTurnData {
  content?: string;
  requestType?: string;
  references?: { uri?: string; path?: string; external?: string }[];
}

interface XcodeAssistantData {
  content?: string;
  editAgentRounds?: { reply?: string; toolCalls?: { name?: string; input?: Record<string, unknown> }[] }[];
  fileEdits?: { filePath?: string; fileURL?: string }[];
  turnStatus?: string;
}

function parseAssistantReply(turns: XcodeTurnRow[], index: number): { assistantContent: string; assistantData: XcodeAssistantData | null } {
  if (index + 1 >= turns.length || turns[index + 1].role !== 'assistant') {
    return { assistantContent: '', assistantData: null };
  }

  try {
    const assistantData = JSON.parse(turns[index + 1].data) as XcodeAssistantData;
    let assistantContent = assistantData?.content || '';
    if (!assistantContent && Array.isArray(assistantData?.editAgentRounds)) {
      assistantContent = assistantData.editAgentRounds
        .map(round => round.reply || '')
        .filter(Boolean)
        .join('\n');
    }
    return { assistantContent, assistantData };
  } catch {
    return { assistantContent: '', assistantData: null };
  }
}

function extractToolsFromRounds(rounds: Array<{ toolCalls?: Array<{ name?: string }> }>): string[] {
  const toolsUsed: string[] = [];
  for (const round of rounds) {
    for (const tc of round.toolCalls ?? []) {
      if (tc.name) toolsUsed.push(tc.name);
    }
  }
  return toolsUsed;
}

function extractEditedFiles(assistantData: XcodeAssistantData | null): string[] {
  const editedFiles: string[] = [];
  if (assistantData?.fileEdits) {
    for (const fileEdit of assistantData.fileEdits) {
      const fp = fileEdit.filePath
        || (typeof fileEdit.fileURL === 'string'
          ? fileEdit.fileURL.replace(/^file:\/\//, '')
          : '');
      if (fp) editedFiles.push(fp);
    }
  }
  return editedFiles;
}

function extractReferencedFiles(turnData: XcodeTurnData): string[] {
  const referencedFiles: string[] = [];
  if (Array.isArray(turnData.references)) {
    for (const ref of turnData.references) {
      if (typeof ref !== 'object' || !ref) continue;
      const refPath = ref.uri || ref.path || ref.external || '';
      if (refPath) referencedFiles.push(String(refPath));
    }
  }
  return referencedFiles;
}

function computeElapsed(turns: XcodeTurnRow[], i: number, turn: XcodeTurnRow): number | null {
  if (i + 1 < turns.length && turns[i + 1].role === 'assistant') {
    const userMs = turn.createdAt * 1000;
    const assistantMs = turns[i + 1].createdAt * 1000;
    if (assistantMs > userMs) return assistantMs - userMs;
  }
  return null;
}

function processTurn(
  turns: XcodeTurnRow[],
  i: number,
  turn: XcodeTurnRow,
  turnData: XcodeTurnData,
): SessionRequest | null {
  if (turn.role !== 'user') return null;

  const userContent = turnData.content || '';
  const requestType = turnData.requestType || '';
  const { assistantContent, assistantData } = parseAssistantReply(turns, i);

  const totalElapsed = computeElapsed(turns, i, turn);
  const editedFiles = extractEditedFiles(assistantData);
  const referencedFiles = extractReferencedFiles(turnData);

  const toolsUsed = Array.isArray(assistantData?.editAgentRounds)
    ? extractToolsFromRounds(assistantData.editAgentRounds)
    : [];

  return createRequest({
    requestId: turn.id,
    timestamp: turn.createdAt * 1000,
    messageText: userContent,
    responseText: assistantContent,
    isCanceled: assistantData?.turnStatus === 'canceled',
    agentName: 'Copilot (Xcode)',
    agentMode: requestType || 'conversation',
    toolsUsed,
    editedFiles,
    referencedFiles,
    totalElapsed,
    userCode: extractCodeBlocks(userContent),
    aiCode: extractCodeBlocks(assistantContent),
    endState: 'no-data',
  });
}

function buildXcodeSession(
  conversation: XcodeConversationRow,
  turns: XcodeTurnRow[],
  onTurnParseError?: (turnId: string, error: unknown) => void,
): Session | null {
  if (turns.length === 0) return null;

  const requests: SessionRequest[] = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    let turnData: XcodeTurnData;
    try {
      turnData = JSON.parse(turn.data) as XcodeTurnData;
    } catch (error) {
      onTurnParseError?.(turn.id, error);
      continue;
    }

    const request = processTurn(turns, i, turn, turnData);
    if (request) requests.push(request);
  }

  if (requests.length === 0) return null;

  return createSession({
    sessionId: conversation.id,
    workspaceId: `xcode-${conversation.id}`,
    workspaceName: conversation.title || 'Xcode Chat',
    location: 'xcode',
    harness: 'Xcode',
    creationDate: conversation.createdAt * 1000,
    lastMessageDate: turns[turns.length - 1].createdAt * 1000,
    requests,
    hasDevcontainer: detectDevcontainerFromRequests(requests),
  });
}

export function parseXcodeDatabases(xcodeBase: string): Session[] {
  const sessions: Session[] = [];
  const dbFiles = findXcodeDbFiles(xcodeBase);

  // Check sqlite3 is available
  try { execFileSync('sqlite3', ['--version'], { encoding: 'utf-8', timeout: 3000 }); }
  catch (e) {
    console.debug('sqlite3 not available, skipping Xcode parsing:', e instanceof Error ? e.message : e);
    return sessions;
  }

  for (const dbPath of dbFiles) {
    let conversations: XcodeConversationRow[];
    try {
      const raw = sqliteQuery(dbPath, 'SELECT id, title, createdAt, updatedAt FROM Conversation');
      if (!raw.trim()) continue;
      conversations = JSON.parse(raw) as XcodeConversationRow[];
    } catch (e) {
      console.debug(`Failed to parse conversations from ${dbPath}:`, e instanceof Error ? e.message : e);
      continue;
    }

    for (const conv of conversations) {
      // Validate conversation ID to prevent SQL injection
      if (!/^[\w-]+$/.test(conv.id)) continue;

      let turns: XcodeTurnRow[];
      try {
        const raw = sqliteQuery(dbPath,
          `SELECT rowID, id, role, data, createdAt FROM Turn WHERE conversationID = '${conv.id}' ORDER BY rowID`);
        if (!raw.trim()) continue;
        turns = JSON.parse(raw) as XcodeTurnRow[];
      } catch (e) {
        console.debug(`Failed to parse turns for conversation ${conv.id}:`, e instanceof Error ? e.message : e);
        continue;
      }

      const session = buildXcodeSession(conv, turns, (turnId, error) => {
        console.debug(`Failed to parse turn data for turn ${turnId}:`, error instanceof Error ? error.message : error);
      });
      if (session) sessions.push(session);
    }
  }

  return sessions;
}

/** Async version with per-conversation yields and non-blocking sqlite3 queries. */
export async function parseXcodeDatabasesAsync(xcodeBase: string): Promise<Session[]> {
  const sessions: Session[] = [];
  const dbFiles = findXcodeDbFiles(xcodeBase);

  // Check sqlite3 is available
  try { execFileSync('sqlite3', ['--version'], { encoding: 'utf-8', timeout: 3000 }); }
  catch { return sessions; }

  for (const dbPath of dbFiles) {
    let conversations: XcodeConversationRow[];
    try {
      const raw = await sqliteQueryAsync(dbPath, 'SELECT id, title, createdAt, updatedAt FROM Conversation');
      if (!raw.trim()) continue;
      conversations = JSON.parse(raw) as XcodeConversationRow[];
    } catch { continue; }

    for (const conv of conversations) {
      if (!/^[\w-]+$/.test(conv.id)) continue;

      let turns: XcodeTurnRow[];
      try {
        turns = await sqliteQueryTurnsAsync(dbPath, conv.id);
      } catch { continue; }

      const session = buildXcodeSession(conv, turns);
      if (session) sessions.push(session);

      // Yield between conversations so the event loop stays responsive
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }

  return sessions;
}
