/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { WebviewMessage, ErrorResult } from '../core/types';

export type RequestMessage = Extract<WebviewMessage, { type: 'request' }>;

/**
 * Build a typed error payload. Use this instead of `{ error: 'msg' }` literals
 * so TypeScript enforces the canonical `ErrorResult` shape defined in core/types.
 */
export function errorResult(message: string, extra: Record<string, unknown> = {}): ErrorResult {
  return { error: message, ...extra };
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRequestMessage(value: unknown): value is RequestMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.type === 'request' && isString(record.id) && isString(record.method);
}

export function postResponse(webview: vscode.Webview, id: string, data: unknown): void {
  webview.postMessage({ type: 'response', id, data });
}

export function postError(webview: vscode.Webview, id: string, message: string, extra: Record<string, unknown> = {}): void {
  webview.postMessage({ type: 'response', id, data: errorResult(message, extra) });
}

export function postEvent(webview: vscode.Webview, method: string, data: unknown): void {
  webview.postMessage({ type: 'event', method, data });
}

export function getNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
}