import { useCallback, useRef, useState } from 'react';

export type StatusTone = 'idle' | 'busy' | 'success' | 'error';
export type StatusMessage = { tone: StatusTone; message: string };

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return '操作失败，请重试。';
}

export type AsyncRunOptions<T> = { busy?: string; success?: (value: T) => string; error?: (error: unknown) => string };

export type AsyncStatusController = {
  status: StatusMessage;
  busy: boolean;
  set: (tone: StatusTone, message: string) => void;
  clear: () => void;
  run: <T>(task: () => Promise<T> | T, options?: AsyncRunOptions<T>) => Promise<T | undefined>;
};

/* One place decides how async work speaks to the user. Identical consecutive
   messages are dropped so a polling refresh cannot machine-gun a live region. */
export function useAsyncStatus(): AsyncStatusController {
  const [status, setStatus] = useState<StatusMessage>({ tone: 'idle', message: '' });
  const [busyCount, setBusyCount] = useState(0);
  const pending = useRef(0);

  const set = useCallback((tone: StatusTone, message: string) => {
    setStatus((current) => (current.tone === tone && current.message === message ? current : { tone, message }));
  }, []);

  const clear = useCallback(() => {
    setStatus((current) => (current.tone === 'idle' && current.message === '' ? current : { tone: 'idle', message: '' }));
  }, []);

  const run = useCallback(async <T,>(task: () => Promise<T> | T, options: AsyncRunOptions<T> = {}) => {
    pending.current += 1;
    setBusyCount(pending.current);
    if (options.busy) set('busy', options.busy);
    try {
      const value = await task();
      if (options.success) set('success', options.success(value));
      return value;
    } catch (error) {
      set('error', options.error ? options.error(error) : errorText(error));
      return undefined;
    } finally {
      pending.current = Math.max(0, pending.current - 1);
      setBusyCount(pending.current);
    }
  }, [set]);

  return { status, busy: busyCount > 0, set, clear, run };
}
