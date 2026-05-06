/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest';
import { DSL_CHEATSHEET } from './dsl-cheatsheet';

describe('DSL_CHEATSHEET', () => {
  it('is a non-empty string', () => {
    expect(typeof DSL_CHEATSHEET).toBe('string');
    expect(DSL_CHEATSHEET.length).toBeGreaterThan(200);
  });

  it('documents the four required sections', () => {
    expect(DSL_CHEATSHEET).toContain('Rule Structure');
    expect(DSL_CHEATSHEET).toMatch(/Row Fields|row fields/i);
    expect(DSL_CHEATSHEET).toMatch(/DSL Functions|functions/i);
    expect(DSL_CHEATSHEET).toMatch(/Match Operators|operators/i);
  });

  it('mentions the detect fenced-block markers', () => {
    expect(DSL_CHEATSHEET).toContain('scan:');
    expect(DSL_CHEATSHEET).toContain('match:');
    expect(DSL_CHEATSHEET).toContain('check:');
  });
});
