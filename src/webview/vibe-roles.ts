/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Vibe Role assignment based on anti-pattern data */

import { DateFilter } from '../core/types';
import { rpc } from './shared';
import { html, render } from './render';

interface ApPattern {
  id: string;
  name: string;
  severity: string;
  occurrences: number;
}

interface ApData {
  patterns: ApPattern[];
  totalOccurrences: number;
}

interface VibeRole {
  title: string;
  emoji: string;
  description: string;
}

const VIBE_ROLES: Record<string, VibeRole> = {
  'yolo-mode':             { title: 'YOLO King',              emoji: '\u{1F451}', description: 'Auto-approves everything. Living on the edge.' },
  'speed-accept':          { title: 'Speed Demon',            emoji: '\u{1F3CE}\u{FE0F}', description: 'Accepts AI code faster than they can read it.' },
  'copy-paste-blindness':  { title: 'Copy-Paste Warrior',     emoji: '\u{1F4CB}', description: 'If AI wrote it, it must be correct... right?' },
  'mega-sessions':         { title: 'Session Marathoner',     emoji: '\u{1F3C3}', description: 'Never met a session they couldn\'t stretch to 100+ messages.' },
  'frustration-signals':   { title: 'Rage Coder',             emoji: '\u{1F92C}', description: 'When things break, the keyboard pays the price.' },
  'profanity':             { title: 'Potty Mouth',            emoji: '\u{1F92D}', description: 'Expresses frustration... colorfully.' },
  'caps-lock':             { title: 'Caps Lock Commander',    emoji: '\u{1F4E2}', description: 'WHY WHISPER WHEN YOU CAN SHOUT.' },
  'late-night-coding':     { title: 'Night Owl',              emoji: '\u{1F989}', description: 'Best code happens at 3am. Or does it?' },
  'weekend-overwork':      { title: 'Weekend Warrior',        emoji: '\u{2694}\u{FE0F}', description: 'Saturdays are for coding, obviously.' },
  'lazy-prompting':        { title: 'Prompt Minimalist',      emoji: '\u{1F90F}', description: '"fix it" is a perfectly clear prompt.' },
  'model-overreliance':    { title: 'Model Monogamist',       emoji: '\u{1F48D}', description: 'One model to rule them all.' },
  'no-file-context':       { title: 'Context-Free Coder',     emoji: '\u{1F648}', description: 'Who needs file context when you have vibes?' },
  'repeated-prompts':      { title: 'Prompt Recycler',        emoji: '\u{267B}\u{FE0F}', description: 'Maybe the 5th time will give a different answer.' },
  'no-plan-mode':          { title: 'Plan Skipper',           emoji: '\u{1F3AF}', description: 'Planning is for people who don\'t trust their instincts.' },
  'abandon-sessions':      { title: 'One-Shot Wonder',        emoji: '\u{1F4A8}', description: 'One prompt and out. No follow-ups needed.' },
  'runaway-agent-loops':   { title: 'Loop Commander',         emoji: '\u{1F300}', description: 'Lets the agent spin until it figures it out... or doesn\'t.' },
  'tunnel-vision':         { title: 'Tunnel Visionary',       emoji: '\u{1F50D}', description: 'One workspace, one mission, no distractions.' },
  'no-custom-instructions':{ title: 'Factory Settings',       emoji: '\u{1F4E6}', description: 'Customization? Never heard of it.' },
  'session-drift':         { title: 'Session Drifter',        emoji: '\u{1F32A}\u{FE0F}', description: 'Started fixing a bug, ended refactoring the universe.' },
  'premium-waste':         { title: 'Premium Burner',         emoji: '\u{1F4B8}', description: 'Uses GPT-4 to ask what day it is.' },
  'no-spec-structure':     { title: 'Vibes-Only Developer',   emoji: '\u{1F3B6}', description: 'Specs are just suggestions anyway.' },
  'auto-approve-terminal': { title: 'Terminal Trust Fund',    emoji: '\u{1F4BB}', description: 'rm -rf /? Sure, auto-approve that.' },
  'high-cancellation':     { title: 'Cancel Culture',         emoji: '\u{274C}', description: 'Why wait for a response when you can cancel and retry?' },
  'no-slash-commands':     { title: 'Slash-Free Zone',        emoji: '\u{2328}\u{FE0F}', description: 'Types everything out the hard way.' },
  'no-skills':             { title: 'Skill-less Adventurer',  emoji: '\u{1F9ED}', description: 'Going it alone without any special skills.' },
  'slow-responses':        { title: 'Patience Tester',        emoji: '\u{23F3}', description: 'Their prompts make the AI think... a lot.' },
};

const FALLBACK_ROLES: VibeRole[] = [
  { title: 'AI Whisperer',          emoji: '\u{1F9D9}', description: 'Clean habits, great prompts. The AI loves working with you.' },
  { title: 'Disciplined Developer', emoji: '\u{1F3C6}', description: 'No bad patterns detected. Keep up the great work.' },
];

function computeVibeRole(patterns: ApPattern[]): { role: VibeRole; reason: string } {
  if (patterns.length === 0) {
    const role = FALLBACK_ROLES[Math.floor(Math.random() * FALLBACK_ROLES.length)];
    return { role, reason: 'No anti-patterns detected' };
  }
  const top = patterns[0];
  const role = VIBE_ROLES[top.id] || { title: 'Reckless Innovator', emoji: '\u{1F680}', description: 'Breaking all the rules and writing code anyway.' };
  return { role, reason: `Top pattern: ${top.name} (${top.occurrences} occurrences, ${top.severity} severity)` };
}

export async function updateVibeRole(filter: DateFilter): Promise<void> {
  const el = document.getElementById('vibe-role');
  if (!el) return;

  try {
    const data = await rpc<ApData>('getAntiPatterns', filter as Record<string, unknown>);
    const patterns = data.patterns || [];
    const { role, reason } = computeVibeRole(patterns);

    el.style.display = '';
    el.setAttribute('title', reason);
    render(html`
      <span class="vibe-role-emoji" title=${reason}>${role.emoji}</span>
      <span class="vibe-role-text" title=${reason}>
        <span class="vibe-role-title">${role.title}</span>
        <span class="vibe-role-reason">${reason}</span>
      </span>
    `, el);
  } catch {
    el.style.display = 'none';
  }
}
