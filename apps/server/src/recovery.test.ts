import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRecovery, wakeRecovery } from './recovery';

afterEach(() => vi.useRealTimers());

describe('idle recovery', () => {
  const epoch = new Date('2026-10-31T00:00:00Z');

  it('sleeps between hourly audits but wakes for committed work', async () => {
    vi.useFakeTimers({ now: epoch });
    const run = vi.fn().mockResolvedValue(undefined);
    const stop = startRecovery({ run, hasPending: async () => false, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(3_599_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 100; i++) wakeRecovery();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(3);
    await stop();
    wakeRecovery();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps retrying pending purchases and failures without overlapping', async () => {
    vi.useFakeTimers({ now: epoch });
    const failure = new Error('temporary failure');
    const run = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const hasPending = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const onError = vi.fn();
    const stop = startRecovery({ run, hasPending, onError });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(3);
    await stop();
  });

  it('retains a wake received during a slow check and drains on shutdown', async () => {
    vi.useFakeTimers({ now: epoch });
    let finish!: () => void;
    const run = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const stop = startRecovery({ run, hasPending: async () => false, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(30_000);
    wakeRecovery();
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    await stop();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
