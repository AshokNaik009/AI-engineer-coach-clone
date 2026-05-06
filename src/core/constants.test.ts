/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest';
import {
  MODEL_MULTIPLIERS, MODEL_TOKEN_RATES, LOC_COST_2010,
  TOKEN_DATA_AVAILABLE_FROM,
} from './constants';

describe('MODEL_MULTIPLIERS', () => {
  it('has gpt-4.1 as free (0)', () => {
    expect(MODEL_MULTIPLIERS['gpt-4.1']).toBe(0);
  });

  it('has claude-opus-4 as premium (1)', () => {
    expect(MODEL_MULTIPLIERS['claude-opus-4']).toBe(1);
  });

  it('all values are non-negative numbers', () => {
    for (const [key, val] of Object.entries(MODEL_MULTIPLIERS)) {
      expect(val, `${key} should be >= 0`).toBeGreaterThanOrEqual(0);
      expect(typeof val).toBe('number');
    }
  });
});

describe('named constants', () => {
  it('LOC_COST_2010 is positive', () => {
    expect(LOC_COST_2010).toBeGreaterThan(0);
  });

  it('TOKEN_DATA_AVAILABLE_FROM is a valid ISO date string', () => {
    expect(TOKEN_DATA_AVAILABLE_FROM).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Sanity check: the cutoff is in the recent past, not the future.
    const today = new Date().toISOString().slice(0, 10);
    expect(TOKEN_DATA_AVAILABLE_FROM <= today).toBe(true);
  });
});

describe('MODEL_TOKEN_RATES', () => {
  // Spot-checks against the official GitHub Copilot pricing page
  // (https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing).
  // These tests catch silent drift between our pricing constants and the
  // upstream rates that drive credit math.
  it.each([
    // [model, input, cached, output, cacheWrite?]
    ['gpt-4.1',           2.00, 0.50,  8.00],
    ['gpt-5-mini',        0.25, 0.025, 2.00],
    ['gpt-5.2',           1.75, 0.175, 14.00],
    ['gpt-5.4',           2.50, 0.25,  15.00],
    ['gpt-5.4-mini',      0.75, 0.075, 4.50],
    ['gpt-5.4-nano',      0.20, 0.02,  1.25],
    ['gpt-5.5',           5.00, 0.50,  30.00],
    ['claude-haiku-4.5',  1.00, 0.10,  5.00,  1.25],
    ['claude-sonnet-4.6', 3.00, 0.30,  15.00, 3.75],
    ['claude-opus-4.7',   5.00, 0.50,  25.00, 6.25],
    ['gemini-2.5-pro',    1.25, 0.125, 10.00],
    ['gemini-3-flash',    0.50, 0.05,  3.00],
    ['gemini-3.1-pro',    2.00, 0.20,  12.00],
    ['grok-code-fast-1',  0.20, 0.02,  1.50],
    ['raptor-mini',       0.25, 0.025, 2.00],
    ['goldeneye',         1.25, 0.125, 10.00],
  ])('%s pricing matches the published rate card', (...args: [string, number, number, number, number?]) => {
    const [model, input, cached, output, cacheWrite] = args;
    const rate = MODEL_TOKEN_RATES[model];
    expect(rate, `${model} should be in MODEL_TOKEN_RATES`).toBeDefined();
    expect(rate.input).toBe(input);
    expect(rate.cached).toBe(cached);
    expect(rate.output).toBe(output);
    if (cacheWrite !== undefined) {
      expect(rate.cacheWrite).toBe(cacheWrite);
    }
  });
});
