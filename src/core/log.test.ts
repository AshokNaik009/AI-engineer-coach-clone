/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debugCore, infoCore, warnCore, errorCore } from './log';

describe('core log', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => { /* noop */ });
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => { /* noop */ });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* noop */ });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes each level to the matching console method', () => {
    debugCore('unit', 'dbg');
    infoCore('unit', 'inf');
    warnCore('unit', 'wrn');
    errorCore('unit', 'err');
    expect(debugSpy).toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('formats the prefix as "[scope] message"', () => {
    warnCore('parser', 'boom');
    expect(warnSpy).toHaveBeenCalledWith('[parser] boom');
  });

  it('appends string detail after a colon', () => {
    warnCore('parser', 'boom', 'line 42');
    expect(warnSpy).toHaveBeenCalledWith('[parser] boom: line 42');
  });

  it('converts Error detail to its message', () => {
    errorCore('parser', 'oops', new Error('bad input'));
    expect(errorSpy).toHaveBeenCalledWith('[parser] oops: bad input');
  });
});
