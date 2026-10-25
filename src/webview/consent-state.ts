/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Unified Claude-powered consent, persisted in globalState (spec §5.1). */

import type * as vscode from 'vscode';

export const CLAUDE_POWERED_CONSENT_KEY = 'claudePoweredConsented';
/** Pre-2.0 key; migrated on activate so Session Chat users never see the card twice. */
const LEGACY_SESSION_CHAT_CONSENT_KEY = 'sessionChatConsented';

export function hasClaudePoweredConsent(state: vscode.Memento): boolean {
  return state.get<boolean>(CLAUDE_POWERED_CONSENT_KEY, false)
    || state.get<boolean>(LEGACY_SESSION_CHAT_CONSENT_KEY, false);
}

/** Run once on activate (§9.8): copy the legacy flag forward. */
export async function migrateClaudePoweredConsent(state: vscode.Memento): Promise<void> {
  if (state.get<boolean>(CLAUDE_POWERED_CONSENT_KEY, false)) return;
  if (state.get<boolean>(LEGACY_SESSION_CHAT_CONSENT_KEY, false)) {
    await state.update(CLAUDE_POWERED_CONSENT_KEY, true);
  }
}
