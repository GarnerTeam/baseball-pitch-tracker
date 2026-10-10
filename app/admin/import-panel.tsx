'use client';
import { useCallback, useEffect, useState } from 'react';

interface Counts {
  dataStore: string;
  totals: { pitches: number; players: number; rosters: number };
  byScope: { scope: string; pitches: number; games: number }[];
}

export function ImportPanel() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [sheetByScope, setSheetByScope] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/import-sheet');
    const json = await res.json();
    if (json.error) setError(json.error); else setCounts(json);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function runImport() {
    setRunning(true); setError(null); setLog([]); setSheetByScope(null);
    const tally: Record<string, number> = {};
    try {
      let offset = 0;
      for (;;) {
        const res = await fetch('/api/admin/import-sheet', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offset }),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        for (const [k, v] of Object.entries(json.sheetByScope as Record<string, number>)) tally[k] = (tally[k] ?? 0) + v;
        setLog(l => [...l, `Rows ${json.offset + 1}–${json.nextOffset} of ${json.total}: ${json.imported.pitches} pitches` +
          (json.offset === 0 ? `, ${json.imported.players} players, ${json.imported.rosters} roster rows` : '')]);
        if (json.done) break;
        offset = json.nextOffset;
      }
      setSheetByScope(tally);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const scopes = counts ? Array.from(new Set([...counts.byScope.map(s => s.scope), ...Object.keys(sheetByScope ?? {})])).sort() : [];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Database import</h1>
          <p className="text-slate-400 mt-1">
            Copies every pitch, player and saved roster from the Google Sheet into Postgres. Safe to run more than once —
            existing rows are updated, never duplicated.
          </p>
        </div>

        {counts && (
          <div className="rounded-xl border border-slate-800 p-4 space-y-1">
            <p>Data store mode: <span className="font-semibold">{counts.dataStore}</span></p>
            <p className="text-slate-400">
              In Postgres now: {counts.totals.pitches} pitches · {counts.totals.players} players · {counts.totals.rosters} roster rows
            </p>
          </div>
        )}

        <button
          onClick={runImport}
          disabled={running}
          className="h-11 px-5 rounded-xl bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-semibold"
        >
          {running ? 'Importing…' : 'Import from Sheet'}
        </button>

        {error && <p className="text-red-400">{error}</p>}
        {log.length > 0 && (
          <ul className="text-sm text-slate-400 space-y-1">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
        )}

        {sheetByScope && counts && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">Organization</th><th>Sheet pitches</th><th>Postgres pitches</th><th></th>
              </tr>
            </thead>
            <tbody>
              {scopes.map(s => {
                const inSheet = sheetByScope[s] ?? 0;
                const inDb = counts.byScope.find(x => x.scope === s)?.pitches ?? 0;
                return (
                  <tr key={s} className="border-t border-slate-800">
                    <td className="py-1 font-mono text-xs">{s}</td><td>{inSheet}</td><td>{inDb}</td>
                    <td className={inDb >= inSheet ? 'text-emerald-400' : 'text-amber-400'}>{inDb >= inSheet ? 'match' : 'missing rows'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {sheetByScope && (
          <p className="text-slate-500 text-xs">
            Counts are unique pitches; a pitch that a retried sync wrote twice to the Sheet counts once. Postgres can show
            more than the Sheet if pitches were recorded while the import ran.
          </p>
        )}
      </div>
    </main>
  );
}
