/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* One consent card for every Claude-powered feature (spec §5). Session Chat,
 * Atlas and Prompt Studio's Improve all call `ensureClaudePoweredConsent`
 * before anything spawns the `claude` CLI. The decision is persisted in
 * globalState by the host (`claudePoweredConsent` RPC) and migrated from the
 * pre-2.0 Session Chat flag on activate. */

import { html, render } from './render';
import { rpc } from './shared';

let cachedConsent: boolean | undefined;

export async function hasClaudePoweredConsent(): Promise<boolean> {
  if (cachedConsent === true) return true;
  try {
    cachedConsent = (await rpc<{ consented: boolean }>('claudePoweredConsent', {})).consented;
  } catch {
    cachedConsent = false;
  }
  return cachedConsent;
}

export function renderClaudeConsentCard(container: HTMLElement, onAccept: () => void, onDecline?: () => void): void {
  render(html`
    <div class="chat-consent atlas-consent">
      <h3>Claude-powered features</h3>
      <p>These features spawn the <code>claude</code> CLI on your machine using your own Claude account. They:</p>
      <ul>
        <li>spend your Claude usage / API credits,</li>
        <li>read files in the current workspace (Atlas),</li>
        <li>append to your <code>~/.claude</code> session history (Session Chat),</li>
        <li>write generated HTML to this extension's storage — never into your repository unless you export it.</li>
      </ul>
      <p>No data is sent anywhere by this extension; the CLI talks to Anthropic directly. You can disable each feature in Settings at any time.</p>
      <div class="atlas-consent-actions">
        <button class="btn-primary" id="claude-consent-accept">Enable Claude-powered features</button>
        ${onDecline ? html`<button class="chat-btn-ghost" id="claude-consent-decline">Not now</button>` : null}
      </div>
    </div>
  `, container);
  container.querySelector<HTMLButtonElement>('#claude-consent-accept')?.addEventListener('click', () => {
    cachedConsent = true;
    void rpc('claudePoweredConsent', { ack: true }).catch(() => { /* best effort */ });
    onAccept();
  });
  container.querySelector<HTMLButtonElement>('#claude-consent-decline')?.addEventListener('click', () => onDecline?.());
}

/** Resolve true when consent exists (or is granted now); false if declined. */
export function ensureClaudePoweredConsent(container: HTMLElement): Promise<boolean> {
  return hasClaudePoweredConsent().then(consented => {
    if (consented) return true;
    return new Promise<boolean>(resolve => {
      renderClaudeConsentCard(container, () => resolve(true), () => resolve(false));
    });
  });
}
