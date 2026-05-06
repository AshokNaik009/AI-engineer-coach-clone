/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Centralized SVG icon library -- all icons are 16x16 inline SVGs, no emoji */

import { html, type ComponentChildren } from './render';

const icon = (d: string): ComponentChildren =>
  html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" dangerouslySetInnerHTML=${{ __html: d }}></svg>`;

export const SVG = {
  /* ── Level Up / Feature Icons ─────────────────────────────────── */
  gear: icon('<path d="M8 10a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" stroke-width="1.3"/><path d="M13.3 6.5l-.9-.2a4.8 4.8 0 00-.5-1.2l.5-.8a.5.5 0 00-.1-.6l-.9-.9a.5.5 0 00-.6-.1l-.8.5a4.8 4.8 0 00-1.2-.5l-.2-.9a.5.5 0 00-.5-.4H6.8a.5.5 0 00-.5.4l-.2.9c-.4.1-.8.3-1.2.5l-.8-.5a.5.5 0 00-.6.1l-.9.9a.5.5 0 00-.1.6l.5.8c-.2.4-.4.8-.5 1.2l-.9.2a.5.5 0 00-.4.5v1.3a.5.5 0 00.4.5l.9.2c.1.4.3.8.5 1.2l-.5.8a.5.5 0 00.1.6l.9.9a.5.5 0 00.6.1l.8-.5c.4.2.8.4 1.2.5l.2.9a.5.5 0 00.5.4h1.3a.5.5 0 00.5-.4l.2-.9c.4-.1.8-.3 1.2-.5l.8.5a.5.5 0 00.6-.1l.9-.9a.5.5 0 00.1-.6l-.5-.8c.2-.4.4-.8.5-1.2l.9-.2a.5.5 0 00.4-.5V7a.5.5 0 00-.4-.5z" stroke="currentColor" stroke-width="1.2"/>'),

  trophy: icon('<path d="M5 2h6v5a3 3 0 01-6 0V2z" stroke="currentColor" stroke-width="1.3"/><path d="M5 4H3a1 1 0 00-1 1v1a2 2 0 002 2h1M11 4h2a1 1 0 011 1v1a2 2 0 01-2 2h-1" stroke="currentColor" stroke-width="1.2"/><path d="M6 10.5v1.5h4v-1.5M5 14h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),

  brain: icon('<path d="M8 14V8M8 8C8 6 6.5 4.5 5 4.5S2 5.5 2 7c0 1 .5 1.8 1.2 2.3M8 8c0-2 1.5-3.5 3-3.5S14 5.5 14 7c0 1-.5 1.8-1.2 2.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.2 9.3C2.5 10 2.5 11 3 11.8c.5.7 1.5 1 2.3.8M12.8 9.3c.7.7.7 1.7.2 2.5-.5.7-1.5 1-2.3.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),

  clipboard: icon('<path d="M5 2h1a2 2 0 014 0h1a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.3"/><path d="M6.5 2.5a1.5 1.5 0 013 0" stroke="currentColor" stroke-width="1.2"/><path d="M6 7h4M6 9.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),

  refresh: icon('<path d="M2.5 8a5.5 5.5 0 019.5-3.5M13.5 8a5.5 5.5 0 01-9.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M12 2v3h-3M4 14v-3h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),

  barChart: icon('<rect x="1" y="9" width="3" height="5" rx="0.5" fill="currentColor"/><rect x="5.5" y="5" width="3" height="9" rx="0.5" fill="currentColor"/><rect x="10" y="2" width="3" height="12" rx="0.5" fill="currentColor"/>'),

  /* ── Achievements ───────────────────────────────────────────── */
  penguin: icon('<ellipse cx="8" cy="10" rx="4" ry="5" stroke="currentColor" stroke-width="1.3" fill="none"/><ellipse cx="8" cy="10" rx="2" ry="3.5" stroke="currentColor" stroke-width="1" fill="none"/><circle cx="6.5" cy="7.5" r="0.7" fill="currentColor"/><circle cx="9.5" cy="7.5" r="0.7" fill="currentColor"/><path d="M7 4C7 2.5 8 1.5 8 1.5s1 1 1 2.5" stroke="currentColor" stroke-width="1"/>'),

  fire: icon('<path d="M8 2c0 2-2 3.5-2 6a2.5 2.5 0 005 0c0-2.5-2-4-2-6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10a1.5 1.5 0 003 0c0-1-1-2-1.5-3-.5 1-1.5 2-1.5 3z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>'),

  runner: icon('<circle cx="10" cy="3" r="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M4 8l3-1.5L9 8l2.5-2M7 6.5L5.5 11l2 .5M9 8l1 3.5 2-.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),

  chat: icon('<path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H6l-3 2.5V11H3a1 1 0 01-1-1V3z" stroke="currentColor" stroke-width="1.3"/><path d="M5 5.5h6M5 8h4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>'),

  robot: icon('<rect x="3" y="4" width="10" height="8" rx="2" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="8" r="1" fill="currentColor"/><circle cx="10" cy="8" r="1" fill="currentColor"/><path d="M8 2v2M6 12v2M10 12v2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M1 7h2M13 7h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),

  flexBicep: icon('<path d="M4 8h2l1-4h2l1 4h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 8v4M11 8v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5 12h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),

  crown: icon('<path d="M2 11l2-5 2 3 2-4 2 4 2-3 2 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="2" y="11" width="12" height="2.5" rx="0.5" stroke="currentColor" stroke-width="1.2"/>'),

  globe: icon('<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><ellipse cx="8" cy="8" rx="3" ry="6" stroke="currentColor" stroke-width="1.1"/><path d="M2 8h12M3 5 h10M3 11h10" stroke="currentColor" stroke-width="0.8"/>'),

  wrench: icon('<rect x="3" y="6" width="10" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M6 6V4a2 2 0 014 0v2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="8.5" r="1" fill="currentColor"/>'),

  microscope: icon('<circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.3"/><path d="M11 5h2M3 5H5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M8 8v2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><rect x="5" y="10" width="6" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/>'),

  dinosaur: icon('<path d="M11 3c1-1 3-.5 3 1s-1 2-2 2h-1l-1 2-2 1v3l-1 2H5l1-2V9L4 8 3 6l1-1 3-.5L9 3h2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="12" cy="4.5" r="0.5" fill="currentColor"/>'),

  owl: icon('<circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="7" r="1.8" stroke="currentColor" stroke-width="1.1"/><circle cx="10" cy="7" r="1.8" stroke="currentColor" stroke-width="1.1"/><circle cx="6" cy="7" r="0.6" fill="currentColor"/><circle cx="10" cy="7" r="0.6" fill="currentColor"/><path d="M7.2 10l.8.8.8-.8" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 3.5L6 5.5M12 3.5L10 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),

  beach: icon('<circle cx="11" cy="3" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M1 13c2-2 4-3 7-3s5 1 7 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M6 10V5L4 6M6 5l2 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'),

  meditation: icon('<circle cx="8" cy="3.5" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M4 14c0-3 1.5-4 4-4s4 1 4 4M5 9l-2 1M11 9l2 1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),

  handshake: icon('<path d="M1 7l3-3h2l2 2 2-2h2l3 3-2 2-2.5-1L8 10 5.5 8 3 9z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 10l-1 3M10 10l1 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),

  bolt: icon('<path d="M9 1.5L4 8.5h4L7 14.5l5-7H8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>'),

  /* ── Achievement categories ─────────────────────────────────── */
  boxPackage: icon('<path d="M2 5l6-3 6 3v7l-6 3-6-3V5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2 5l6 3 6-3M8 8v7" stroke="currentColor" stroke-width="1.1"/>'),

  calendar: icon('<rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),

  rainbow: icon('<path d="M2 13a6 6 0 0112 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M4 13a4 4 0 018 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6 13a2 2 0 014 0" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>'),

  confetti: icon('<path d="M2 14L6 4l2 3 3-2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="11" cy="3" r="0.8" fill="currentColor"/><circle cx="13" cy="6" r="0.8" fill="currentColor"/><circle cx="10" cy="7" r="0.8" fill="currentColor"/><path d="M9 2l1 1M12 4l1-1M13 8l-1 1" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>'),

  target: icon('<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="3.5" stroke="currentColor" stroke-width="1.1"/><circle cx="8" cy="8" r="1" fill="currentColor"/>'),

  /* ── Learning system ────────────────────────────────────────── */
  snake: icon('<path d="M3 4c1-2 4-2 5 0s2 3 4 2 2-3 1-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M3 4c-1 2 0 4 2 5s4 0 5 2 0 4-2 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="12.5" cy="2.5" r="0.6" fill="currentColor"/>'),

  pencilDoc: icon('<path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2"/><path d="M10 2v3h3" stroke="currentColor" stroke-width="1.1"/><path d="M5 8h5M5 10.5h3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>'),

  lightbulb: icon('<path d="M6 12h4M6.5 13.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M5.5 9.5C4 8.5 3.5 7 4 5.5A4 4 0 018 2.5a4 4 0 014 3c.5 1.5 0 3-1.5 4v1h-5v-1z" stroke="currentColor" stroke-width="1.3"/>'),

  tree: icon('<path d="M8 14V8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M8 2L3 7h2.5L3 10h3v2h4v-2h3l-2.5-3H13z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'),

  book: icon('<path d="M2 2.5C3 2 5 1.5 8 3c3-1.5 5-1 6-.5v10c-1-.5-3-1-6 .5-3-1.5-5-1-6-.5v-10z" stroke="currentColor" stroke-width="1.3"/><path d="M8 3v10" stroke="currentColor" stroke-width="1.1"/>'),

  gamepad: icon('<rect x="1" y="5" width="14" height="8" rx="3" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 7.5v3M3 9h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="11" cy="8" r="0.7" fill="currentColor"/><circle cx="13" cy="10" r="0.7" fill="currentColor"/>'),

  checkCircle: icon('<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 8l2 2 3.5-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),

  xCircle: icon('<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'),

  arrowRight: icon('<path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),

  arrowLeft: icon('<path d="M13 8H3M7 4L3 8l4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),

  warning: icon('<path d="M8 1.5L1 14h14L8 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 6v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="12" r="0.7" fill="currentColor"/>'),

  /* ── Xbox-style achievement extras ─────────────────────────── */
  share: icon('<path d="M4 9v4a1 1 0 001 1h6a1 1 0 001-1V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 2v8M5 5l3-3 3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),

  lock: icon('<rect x="4" y="7" width="8" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M6 7V5a2 2 0 014 0v2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),

  unlock: icon('<rect x="4" y="7" width="8" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M6 7V5a2 2 0 014 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),

  star: icon('<path d="M8 1.5l2 4.1 4.5.6-3.3 3.2.8 4.5L8 11.7l-4 2.2.8-4.5L1.5 6.2l4.5-.6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'),

  starFilled: icon('<path d="M8 1.5l2 4.1 4.5.6-3.3 3.2.8 4.5L8 11.7l-4 2.2.8-4.5L1.5 6.2l4.5-.6z" fill="currentColor" stroke="currentColor" stroke-width="0.5"/>'),

  clock: icon('<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M8 4v4l2.5 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),

  shield: icon('<path d="M8 1.5L2.5 4v4c0 3.5 2.5 5.5 5.5 6.5 3-1 5.5-3 5.5-6.5V4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>'),

  shieldCheck: icon('<path d="M8 1.5L2.5 4v4c0 3.5 2.5 5.5 5.5 6.5 3-1 5.5-3 5.5-6.5V4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5.5 8l2 2 3.5-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),

  diamond: icon('<path d="M8 1L2 6l6 9 6-9z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2 6h12" stroke="currentColor" stroke-width="1.1"/>'),

  hexagon: icon('<path d="M8 1.5L13.5 4.5v5L8 14.5L2.5 11.5v-5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>'),

  sparkle: icon('<path d="M8 1v3M8 12v3M1 8h3M12 8h3M3 3l2 2M11 11l2 2M13 3l-2 2M5 11l-2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),

  code: icon('<path d="M5 4L1.5 8 5 12M11 4l3.5 4L11 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 2.5l-3 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),

  compass: icon('<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 5.5L9 9 5.5 10.5 7 7z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" fill="currentColor" fill-opacity="0.3"/>'),

  layers: icon('<path d="M8 2L2 5.5 8 9l6-3.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2 8l6 3.5L14 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 10.5L8 14l6-3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'),

  zap: icon('<path d="M9 1L4 9h4l-1 6 5-8H8z" fill="currentColor" stroke="currentColor" stroke-width="0.5" stroke-linejoin="round"/>'),

  map: icon('<path d="M1.5 3.5l4-1.5v11l-4 1.5zm4-1.5l5 2v11l-5-2zm5 2l4-1.5v11l-4 1.5z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>'),

  terminal: icon('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M4 7l2.5 2L4 11M8 11h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),

  repeat: icon('<path d="M11 2l2 2-2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 8V6a2 2 0 012-2h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5 14l-2-2 2-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 8v2a2 2 0 01-2 2H3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),

  graduationCap: icon('<path d="M8 3L1 6.5 8 10l7-3.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M3 8v3.5c0 1.5 2.5 2.5 5 2.5s5-1 5-2.5V8" stroke="currentColor" stroke-width="1.2"/><path d="M14 6.5v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),

  trendingUp: icon('<path d="M1.5 12l4-4 3 2 6-6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 3.5h4.5V8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),

  externalLink: icon('<path d="M12 9v3.5a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 012 12.5v-7A1.5 1.5 0 013.5 4H7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10 2h4v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 9l7-7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),
};
