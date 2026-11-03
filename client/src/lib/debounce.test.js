import { afterEach, describe, expect, it, vi } from 'vitest';
import { debounce } from './debounce.js';

afterEach(() => vi.useRealTimers());

describe('debounce', () => {
  it('runs once with the last value after typing stops', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const typed = debounce(fn, 400);
    typed('n');
    typed('ni');
    vi.advanceTimersByTime(399);
    typed('nirvana');
    vi.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('nirvana');
  });

  it('can be cancelled when the page goes away', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const typed = debounce(fn, 400);
    typed('abba');
    typed.cancel();
    vi.advanceTimersByTime(1_000);
    expect(fn).not.toHaveBeenCalled();
  });
});
