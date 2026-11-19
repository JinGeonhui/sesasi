import { useEffect, useState } from 'react';
import { listRecords, saveRecord } from './record-store';
import { importLegacyPlanner } from './legacy-import';

export function usePreference(key: string, fallback: string) {
  const [state, setState] = useState({ value: fallback, revision: 0, ready: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        await importLegacyPlanner();
        const rows = await listRecords<string>('preferences');
        const row = rows.find(row => row.key === key);
        if (alive) { setState({ value: row?.value ?? fallback, revision: row?.revision ?? 0, ready: true }); setError(''); }
      } catch { if (alive) setError('날씨 설정을 불러오지 못했어요. 연결 후 다시 시도해 주세요.'); }
    };
    void load();
    window.addEventListener('focus', load); window.addEventListener('online', load);
    return () => { alive = false; window.removeEventListener('focus', load); window.removeEventListener('online', load); };
  }, [key, fallback]);
  async function save(value: string) {
    if (busy || !state.ready) return;
    setBusy(true);
    try { const revision = await saveRecord('preferences', key, value, state.revision); setState({ value, revision, ready: true }); setError(''); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return { value: state.value, save, error, disabled: busy || !state.ready };
}
