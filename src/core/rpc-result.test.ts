/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest';
import { isErrorResult } from './types/rpc-types';

describe('ErrorResult / isErrorResult', () => {
  it('identifies the canonical shape', () => {
    expect(isErrorResult({ error: 'boom' })).toBe(true);
  });

  it('accepts extra fields on the error object', () => {
    expect(isErrorResult({ error: 'bad', field: 'x' })).toBe(true);
  });

  it('rejects non-error-shaped objects', () => {
    expect(isErrorResult({ results: [] })).toBe(false);
    expect(isErrorResult({ error: 123 })).toBe(false);
    expect(isErrorResult(null)).toBe(false);
    expect(isErrorResult(undefined)).toBe(false);
    expect(isErrorResult('error')).toBe(false);
  });
});
