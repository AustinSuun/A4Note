import { useEffect, useRef } from 'react';
import { subscribeCaptureLibraryChanges } from '../../platform/capture';
/** Coalesced event refresh; never selects a different paper or resets the reader. */
export function useCaptureLibraryUpdates(refresh: () => Promise<void>) {
  const latest = useRef(refresh); latest.current = refresh;
  useEffect(() => {
    let active = true; let running = false; let pending = false; let unlisten: (() => void) | undefined;
    const drain = async () => {
      pending = true; if (running) return; running = true;
      try { while (active && pending) { pending = false; await latest.current(); } }
      catch (error) { console.error('采集已入库，但列表刷新失败，可重新打开软件加载', error); }
      finally { running = false; }
    };
    void subscribeCaptureLibraryChanges(() => { if (active) void drain(); }).then(off => { if (active) unlisten = off; else off(); }).catch(console.error);
    return () => { active = false; unlisten?.(); };
  }, []);
}
