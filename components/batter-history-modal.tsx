'use client';
import { useState, useEffect } from 'react';
import { analyzeBatter, cellVerdict, handOf, locationKey, MIN_PITCH, MIN_ZONE, type ScoutPitch } from '@/lib/scouting';

// ── Types ──────────────────────────────────────────────────────────────────────
interface PitchRow {
  gameId?: string;
  timestamp?: string;
  batterName?: string;
  batterNumber?: string;
  batterHand?: string;
  pitchType?: string;
  pitchZone?: string;
  pitchLocation?: string;
  action?: string;
  outcome?: string;
  hitResult?: string;
  hitType?: string;
  hitX?: number | string;
  hitY?: number | string;
  hitZone?: string;
  atBatNumber?: number | string;
  pitchNumber?: number | string;
  ballsBefore?: number | string;
  strikesBefore?: number | string;
}


// ── 1st / 2nd pitch intel helpers ──────────────────────────────────────────────
const OUTCOME_SHORT_MAP: Record<string, string> = {
  ball: 'Ball', 'called-strike': 'Strike', 'swinging-strike': 'Whiff',
  foul: 'Foul', 'foul-tip': 'Foul tip', 'in-play': 'In play', walk: 'BB', strikeout: 'K', 'hit-by-pitch': 'HBP',
};
const OUTCOME_CLR_MAP: Record<string, string> = {
  ball: '#60a5fa', walk: '#38bdf8',
  'called-strike': '#f87171', 'swinging-strike': '#f87171', strikeout: '#ef4444',
  foul: '#fbbf24', 'foul-tip': '#fcd34d', 'in-play': '#34d399',
};

/** Short spot name for the 1st/2nd pitch lists, for this batter's side. */
function pitchLocShort(loc: string | undefined, pitchHand: string | undefined, gridHand: 'R' | 'L'): string {
  if (!loc) return '?';
  const key = locationKey(loc, handOf(pitchHand), gridHand);
  if (key.startsWith('Z')) {
    const n = parseInt(key.slice(1), 10);
    const r = ['Up-In','Up','Up-Away','In','Middle','Away','Down-In','Down','Down-Away'];
    const l = ['Up-Away','Up','Up-In','Away','Middle','In','Down-Away','Down','Down-In'];
    return (gridHand === 'R' ? r : l)[n - 1] ?? key;
  }
  return key.replace(/^B-/, '').replace('Out', 'Away').replace('Up', 'High') + ' (ball)';
}



/** Sort a pitchType→count map descending and return top N as [type, count] pairs. */
function topTypes(map: Record<string, number>, n = 2): [string, number][] {
  return Object.entries(map ?? {}).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ── Pitch-type colour maps (match pitch page) ────────────────────────────
// Display label (Ch not CH) and colours from PITCH_TYPE_COLORS in types/index.ts
const PT_LABEL: Record<string, string> = { FB:'FB', CB:'CB', SL:'SL', CH:'Ch' };
const PT_COLOR: Record<string, string> = {
  FB: '#ef4444',  // red
  CB: '#22c55e',  // green
  SL: '#8b5cf6',  // purple
  CH: '#f97316',  // orange
};
// Dark cell background tinted by pitch type
// ── Hit result display ──────────────────────────────────────────────────────────────────
const RES_LABEL: Record<string, string> = { single:'1B', double:'2B', triple:'3B', 'home-run':'HR', out:'Out', error:'Err' };
const RES_COLOR: Record<string, string> = { single:'#14b8a6', double:'#60a5fa', triple:'#818cf8', 'home-run':'#eab308', out:'#64748b', error:'#f59e0b' };
const RES_ORDER = ['home-run','triple','double','single','error','out'];



// ── Hit zone abbreviations ─────────────────────────────────────────────────
const HZ_ABBR: Record<string, string> = {
  'C': 'C', 'SS': 'SS', '3B': '3B', '2B': '2B', '1B': '1B',
  'Shallow Left': 'Sh·L', 'Shallow Center': 'Sh·C', 'Shallow Right': 'Sh·R',
  'Deep Left': 'Dp·L', 'Deep Center': 'Dp·C', 'Deep Right': 'Dp·R',
  'HR-Lft': 'HR·L', 'HR-LCtr': 'HR·LC', 'HR-RCtr': 'HR·RC', 'HR-Rt': 'HR·R',
  'Foul': 'Foul',
};

// ── 5×5 grid helpers ───────────────────────────────────────────────────────────────────
function cellLocKey(row: number, col: number, h: 'R' | 'L'): string | null {
  if (row >= 1 && row <= 3 && col >= 1 && col <= 3) {
    return `Z${(row - 1) * 3 + (col - 1) + 1}`;
  }
  const r = h === 'R';
  const top = row === 0, bot = row === 4;
  const lft = col <= 1, rgt = col >= 3, mc = col === 2;

  if (top && lft)  return r ? 'B-Up-In'   : 'B-Up-Out';
  if (top && mc)   return 'B-Up';
  if (top && rgt)  return r ? 'B-Up-Out'  : 'B-Up-In';
  if (bot && lft)  return r ? 'B-Low-In'  : 'B-Low-Out';
  if (bot && mc)   return 'B-Low';
  if (bot && rgt)  return r ? 'B-Low-Out' : 'B-Low-In';
  if (lft && row === 1) return r ? 'B-In-Hi'  : 'B-Out-Hi';
  if (lft && row === 2) return r ? 'B-In'     : 'B-Out';
  if (lft && row === 3) return r ? 'B-In-Lo'  : 'B-Out-Lo';
  if (rgt && row === 1) return r ? 'B-Out-Hi' : 'B-In-Hi';
  if (rgt && row === 2) return r ? 'B-Out'    : 'B-In';
  if (rgt && row === 3) return r ? 'B-Out-Lo' : 'B-In-Lo';
  return null;
}


// ── Shadow cells ───────────────────────────────────────────────────────────────────
// Corner pairs (0,1)/(0,0), (0,3)/(0,4), (4,1)/(4,0), (4,3)/(4,4) share the
// same pitchLocation key. The inner cell is a "shadow" — it shows the heat
// colour but no count, so the grid total matches the actual pitch count.
function isShadowCell(row: number, col: number): boolean {
  return (row === 0 || row === 4) && (col === 1 || col === 3);
}

// ── Vertical bat SVG ────────────────────────────────────────────────────────────────
// Barrel at top, knob at bottom — placed left for RHB, right for LHB
function BatSVG() {
  return (
    <svg
      viewBox="0 0 20 300"
      preserveAspectRatio="xMidYMid meet"
      style={{ width: 14, height: '100%', flexShrink: 0, display: 'block' }}
    >
      {/* Barrel */}
      <rect x="1" y="2"   width="18" height="130" rx="9"  fill="#a16207" />
      {/* Taper barrel → handle */}
      <polygon points="1,128 19,128 14,178 6,178" fill="#92400e" />
      {/* Handle */}
      <rect x="6" y="176" width="8"  height="106" rx="4"  fill="#78350f" />
      {/* Knob */}
      <ellipse cx="10" cy="287" rx="10" ry="7" fill="#6b2d0f" />
    </svg>
  );
}

// ── Spray chart SVG constants ───────────────────────────────────────────────────────────────────
const SW=400,SH=390,SHX=200,SHY=365;
const SR_FENCE=270,SR_WARN=220;
const SLFPX=9,SLFPY=174,SRFPX=391,SRFPY=174;
const SB1X=271,SB1Y=294,SB2X=200,SB2Y=224,SB3X=129,SB3Y=294;
const SMX=200,SMY=298;
const SWARN_LX=44,SWARN_LY=209,SWARN_RX=356,SWARN_RY=209;

function hitDotColor(r: string) {
  if (r === 'out')      return '#64748b';
  if (r === 'home-run') return '#eab308';
  if (r === 'error')    return '#f59e0b';
  return '#14b8a6';
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  playerName: string;
  playerNumber: string;
  webhookUrl: string;
  /** The current game's ID — rows with this gameId are stripped from the API
   *  result so today's pitches come exclusively from currentGamePitches. */
  currentGameId?: string;
  /** Live pitches for this batter from the current game (app state, not sheet). */
  currentGamePitches?: PitchRow[];
  /** Explicit data owner — only needed for unauthenticated contexts (Scout).
   *  Inside the logged-in main app this is omitted; the API derives the
   *  owner from the Clerk session instead. */
  ownerId?: string;
  /** Stable Saved Roster id (see lib/roster.ts) for this batter, if he was
   *  loaded from (or saved to) a roster. When present, history is matched
   *  on this id exclusively — the only fully reliable way to tell apart
   *  siblings/same-name players or a guest wearing a different number. */
  playerRosterId?: string;
  /** The side he's hitting from today — the charts are drawn for it. */
  batterHand?: 'L' | 'R' | null;
  onClose: () => void;
}

// ── History cache ───────────────────────────────────────────────────────────
// The Pitch screen prefetches the batter at the plate, so tapping his name
// opens his history instantly instead of waiting on the network.
const CACHE_MS = 5 * 60_000;
const historyCache = new Map<string, { at: number; rows: Promise<PitchRow[]> }>();

function historyKey(q: { playerName: string; playerNumber: string; webhookUrl: string; ownerId?: string; playerRosterId?: string }) {
  return [q.webhookUrl, q.ownerId ?? '', q.playerRosterId ?? '', q.playerName.trim().toLowerCase(), q.playerNumber.trim()].join('|');
}

/** Fetches (or reuses a recent fetch of) a batter's stored pitches. */
export function loadBatterHistory(q: { playerName: string; playerNumber: string; webhookUrl: string; ownerId?: string; playerRosterId?: string }): Promise<PitchRow[]> {
  const key = historyKey(q);
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const qs = new URLSearchParams({ url: q.webhookUrl, batter: q.playerName, num: q.playerNumber });
  if (q.ownerId) qs.set('owner', q.ownerId);
  // The player / roster id, when available, is the reliable identity signal —
  // the backend matches on it exclusively rather than name/number guessing.
  if (q.playerRosterId) qs.set('playerId', q.playerRosterId);
  const rows = fetch(`/api/sheets/history?${qs}`)
    .then(r => r.json())
    .then(d => {
      if (d.error) throw new Error(d.error);
      return (d.pitches ?? []) as PitchRow[];
    });
  rows.catch(() => historyCache.delete(key));
  historyCache.set(key, { at: Date.now(), rows });
  return rows;
}

// ── Component ─────────────────────────────────────────────────────────────────────
export function BatterHistoryModal({
  playerName, playerNumber, webhookUrl,
  currentGameId, currentGamePitches = [], ownerId,
  playerRosterId, batterHand,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // histPitches = historical rows from the sheet (today's gameId excluded)
  const [histPitches, setHistPitches] = useState<PitchRow[]>([]);
  const [view, setView] = useState<'heatmap' | 'spray'>('heatmap');

  // ── Merge historical + current-game pitches ─────────────────────────
  // currentGamePitches come from app state (always fresh); histPitches come from
  // the sheet with today's gameId stripped out — so no duplicates.
  const pitches: PitchRow[] = [...histPitches, ...currentGamePitches];

  useEffect(() => {
    if (!webhookUrl) {
      setFetchError('History is not available right now.');
      setLoading(false);
      return;
    }
    loadBatterHistory({ playerName, playerNumber, webhookUrl, ownerId, playerRosterId })
      .then(allFromSheet => {
        // Exclude today's game — those rows come from currentGamePitches prop
        const hist = currentGameId
          ? allFromSheet.filter(p => p.gameId !== currentGameId)
          : allFromSheet;
        setHistPitches(hist);
      })
      .catch(e => setFetchError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [playerName, playerNumber, webhookUrl, ownerId, playerRosterId]);

  // ── Scouting read-out (lib/scouting.ts) ────────────────────────────────
  const report = analyzeBatter(pitches as ScoutPitch[], batterHand ?? null);
  const gridHand = report.gridHand;
  const totalPitches = report.total;
  const uniqueGames = report.games;

  // ── Spray chart: every ball in play with a location ───────────────────
  const hits = pitches.filter(p =>
    p.hitResult &&
    p.hitX !== '' && p.hitX !== undefined && !isNaN(Number(p.hitX)) &&
    p.hitY !== '' && p.hitY !== undefined && !isNaN(Number(p.hitY))
  );

  // ── Render ─────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 h-dvh h-app z-50 bg-slate-950 flex flex-col">

      {/* Header — pt-safe/h-app clear the iPhone notch/Dynamic Island in
          standalone PWA mode, same fix as Past Games and the main app
          shell (see hooks/use-viewport-height.ts and globals.css). */}
      <div className="flex items-center gap-3 px-4 pb-3 pt-safe bg-slate-900 border-b border-slate-800 flex-shrink-0">
        <button onClick={onClose} className="text-slate-400 hover:text-white text-[30px] leading-none w-8 flex-shrink-0">←</button>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-[23px] leading-tight break-words">#{playerNumber} {playerName}</p>
          <p className="text-slate-500 text-[15px]">
            {loading
              ? 'Loading…'
              : histPitches.length > 0
                ? `${totalPitches} pitches · ${uniqueGames} game${uniqueGames !== 1 ? 's' : ''} · ${gridHand}HB`
                : `${totalPitches} pitches (all from today — no earlier games) · ${gridHand}HB`
            }
          </p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-slate-700 flex-shrink-0">
          <button onClick={() => setView('heatmap')} className={`px-2.5 py-1.5 text-[16px] font-semibold ${view === 'heatmap' ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-400'}`}>🗺 Map</button>
          <button onClick={() => setView('spray')}   className={`px-2.5 py-1.5 text-[16px] font-semibold ${view === 'spray'   ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-400'}`}>🏟 Field</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">

        {loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-400 text-[18px]">Fetching history…</p>
          </div>
        )}

        {!loading && fetchError && (
          <div className="m-4 p-4 bg-red-950 border border-red-800 rounded-xl space-y-2">
            <p className="text-red-300 font-bold text-[21px]">Could not load history</p>
            <p className="text-red-400 text-[17px]">{fetchError}</p>
            <p className="text-slate-500 text-[15px] pt-1 border-t border-red-900">
              Check your connection and try again.
            </p>
          </div>
        )}

        {!loading && !fetchError && totalPitches === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <p className="text-slate-400 text-[21px]">No history found</p>
            <p className="text-slate-600 text-[17px]">for {playerName} #{playerNumber}</p>
          </div>
        )}

        {!loading && !fetchError && totalPitches > 0 && (
          <div className="pb-8 space-y-4">

            {/* Stats strip */}
            <div className="grid grid-cols-4 gap-0 border-b border-slate-800">
              {[
                { label: 'Swing%', value: `${report.summary.swingPct}%` },
                { label: 'Chase%', value: `${report.summary.chasePct}%` },
                { label: 'Whiff%', value: `${report.summary.whiffPct}%` },
                { label: 'Hits-AB', value: `${report.summary.hits}-${report.summary.atBats}` },
              ].map(({ label, value }) => (
                <div key={label} className="py-3 text-center border-r border-slate-800 last:border-r-0">
                  <p className="text-white font-black text-[26px] leading-none">{value}</p>
                  <p className="text-slate-500 text-[14px] mt-0.5 uppercase tracking-wide">{label}</p>
                </div>
              ))}
            </div>

            {/* ══════════ HEAT MAP ══════════ */}
            {view === 'heatmap' && (
              <div className="px-4 space-y-5">

                {/* 5×5 grid */}
                <div className="bg-slate-900 rounded-2xl p-3 border border-slate-800">
                  <p className="text-slate-500 text-[13px] uppercase tracking-widest mb-2 text-center">Catcher&apos;s view · outlined = strike zone · count &amp; pitch types</p>

                  {/* Grid + bat wrapper */}
                  <div className="flex items-stretch gap-1.5">

                    {/* RHB bat — left side (batter stands left from pitcher's view) */}
                    {gridHand === 'R' && (
                      <div className="flex items-stretch py-[14px]">
                        <BatSVG />
                      </div>
                    )}

                    {/* Grid column: top axis + cells + bottom axis */}
                    <div className="flex-1 min-w-0">

                      {/* Legend */}
                      <div className="flex items-center justify-center gap-3 mb-1.5">
                        {([['rgba(22,163,74,0.85)','We win'],['rgba(220,38,38,0.85)','He hits'],['rgba(59,130,246,0.85)','He takes (balls)']] as [string,string][]).map(([c,l]) => (
                          <div key={l} className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded-sm flex-shrink-0" style={{ background: c }} />
                            <span className="text-slate-300 font-semibold" style={{ fontSize: 15 }}>{l}</span>
                          </div>
                        ))}
                      </div>

                      {/* Grid */}
                      <div className="grid gap-[3px]" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                        {Array.from({ length: 5 }).flatMap((_, row) =>
                          Array.from({ length: 5 }).map((_, col) => {
                            const isStrike = row >= 1 && row <= 3 && col >= 1 && col <= 3;
                            const key = cellLocKey(row, col, gridHand);
                            const z   = key ? report.zones[key] : undefined;
                            const s   = { total: z?.total ?? 0, types: Object.fromEntries(Object.entries(z?.byType ?? {}).map(([t, v]) => [t, v.total])) as Record<string, number> };
                            // Colour = who wins in this spot; strength grows with sample size.
                            const confidence = s.total === 0 ? 0
                              : s.total === 1 ? 0.28
                              : s.total === 2 ? 0.50
                              : s.total === 3 ? 0.68
                              : 0.85;
                            const verdict = cellVerdict(z);
                            const cellBgColor = verdict === 'win' ? `rgba(22,163,74,${confidence})`
                              : verdict === 'damage' ? `rgba(220,38,38,${Math.max(confidence, 0.6)})`
                              : verdict === 'takes' ? `rgba(59,130,246,${confidence})`
                              : '#0f172a';
                            // Pitch type entries — scale font so they fit
                            const ptEntries  = topTypes(s.types, 4);
                            const ptCount    = ptEntries.length;
                            const ptFontSize = ptCount <= 1 ? 18 : ptCount === 2 ? 16 : 14;

                            return (
                              <div
                                key={`${row}-${col}`}
                                className="relative flex flex-col items-center justify-center select-none rounded-sm"
                                style={{
                                  background: cellBgColor,
                                  aspectRatio: '1', minHeight: 62,
                                  outline: isStrike ? '2px solid rgba(148,163,184,0.45)' : '1px solid rgba(255,255,255,0.06)',
                                }}
                              >
                                {/* Shadow cells: tint only, no content */}
                                {isShadowCell(row, col) ? null : s.total > 0 ? (
                                  <>
                                    {/* Total pitch count */}
                                    <span className="font-black leading-none text-white" style={{ fontSize: 18 }}>{s.total}</span>
                                    {/* Pitch types in their colours */}
                                    <div className="flex flex-wrap items-center justify-center mt-[3px] px-[2px]" style={{ gap: '2px 4px' }}>
                                      {ptEntries.map(([t, n]) => (
                                        <span key={t} className="font-black leading-none" style={{ fontSize: ptFontSize, color: PT_COLOR[t] ?? '#94a3b8' }}>
                                          {PT_LABEL[t] ?? t} {n}
                                        </span>
                                      ))}
                                    </div>
                                  </>
                                ) : (
                                  <span className="font-black" style={{ fontSize: 18, color: 'rgba(100,116,139,0.2)' }}>·</span>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>



                    </div>{/* end grid column */}

                    {/* LHB bat — right side */}
                    {gridHand === 'L' && (
                      <div className="flex items-stretch py-[14px]">
                        <BatSVG />
                      </div>
                    )}

                  </div>{/* end grid + bat wrapper */}


                </div>

                {/* ── GAME PLAN ── */}
                <div>
                  <p className="text-slate-500 text-[14px] uppercase tracking-widest mb-2">Game Plan</p>

                  <div className="grid grid-cols-2 gap-2 mb-2">

                    {/* Pitch Here — strike-zone spot where we most often win (strike or out) without giving up extra-base hits */}
                    <div className="rounded-xl p-3 border" style={{ background: '#071a0f', borderColor: '#15803d' }}>
                      <p className="text-green-400 text-[13px] font-bold uppercase tracking-wide mb-1">🎯 Pitch Here</p>
                      {report.pitchHere ? (
                        <>
                          <p className="text-white font-black text-[23px] leading-tight">{report.pitchHere.name}</p>
                          <p className="text-green-300 text-[15px] font-semibold mt-1">{report.pitchHere.detail}</p>
                          {report.pitchHere.bestPitch && (
                            <p className="text-[15px] font-bold mt-0.5">
                              <span className="text-green-500">Best: </span>
                              <span style={{ color: PT_COLOR[report.pitchHere.bestPitch.type] ?? '#94a3b8' }}>{PT_LABEL[report.pitchHere.bestPitch.type] ?? report.pitchHere.bestPitch.type}</span>
                              <span className="text-green-500 font-normal"> ({report.pitchHere.bestPitch.detail})</span>
                            </p>
                          )}
                        </>
                      ) : <p className="text-green-900 text-[15px] mt-1">Needs {MIN_ZONE}+ pitches in a zone</p>}
                    </div>

                    {/* Put-away — which pitch finishes him with two strikes */}
                    <div className="rounded-xl p-3 border" style={{ background: '#0f0a1e', borderColor: '#5b21b6' }}>
                      <p className="text-violet-400 text-[13px] font-bold uppercase tracking-wide mb-1">⚡ Put-Away Pitch</p>
                      {report.putAway ? (
                        <>
                          <p className="font-black text-[32px] leading-none" style={{ color: PT_COLOR[report.putAway.name] ?? '#fff' }}>{PT_LABEL[report.putAway.name] ?? report.putAway.name}</p>
                          <p className="text-violet-300 text-[15px] font-semibold mt-1">{report.putAway.detail}</p>
                          {report.putAway.bestPitch && (
                            <p className="text-violet-400 text-[15px] mt-0.5">Best spot: {report.putAway.bestPitch.detail}</p>
                          )}
                        </>
                      ) : <p className="text-violet-900 text-[15px] mt-1">Needs {MIN_PITCH}+ swings or two-strike pitches</p>}
                    </div>

                    {/* Chase — where off the plate he expands */}
                    <div className="rounded-xl p-3 border" style={{ background: '#1c1000', borderColor: '#b45309' }}>
                      <p className="text-amber-400 text-[13px] font-bold uppercase tracking-wide mb-1">🎣 Chase Bait</p>
                      {report.chase ? (
                        <>
                          <p className="text-white font-black text-[23px] leading-tight">{report.chase.name}</p>
                          <p className="text-amber-300 text-[15px] font-semibold mt-1">{report.chase.detail}</p>
                          {report.chase.bestPitch && (
                            <p className="text-[15px] font-bold mt-0.5">
                              <span className="text-amber-500">Chases: </span>
                              <span style={{ color: PT_COLOR[report.chase.bestPitch.type] ?? '#94a3b8' }}>{PT_LABEL[report.chase.bestPitch.type] ?? report.chase.bestPitch.type}</span>
                              <span className="text-amber-500 font-normal"> ({report.chase.bestPitch.detail})</span>
                            </p>
                          )}
                        </>
                      ) : <p className="text-amber-900 text-[15px] mt-1">Needs {MIN_PITCH}+ pitches off the plate</p>}
                    </div>

                    {/* Danger — where his hits come from */}
                    <div className="rounded-xl p-3 border" style={{ background: '#1c0505', borderColor: '#b91c1c' }}>
                      <p className="text-red-400 text-[13px] font-bold uppercase tracking-wide mb-1">🚨 Danger Zone</p>
                      {report.danger ? (
                        <>
                          <p className="text-white font-black text-[23px] leading-tight">{report.danger.name}</p>
                          <p className="text-red-300 text-[15px] font-semibold mt-1">{report.danger.detail}</p>
                          {report.danger.bestPitch && (
                            <p className="text-[15px] font-bold mt-0.5">
                              <span className="text-red-500">Avoid: </span>
                              <span style={{ color: PT_COLOR[report.danger.bestPitch.type] ?? '#94a3b8' }}>{PT_LABEL[report.danger.bestPitch.type] ?? report.danger.bestPitch.type}</span>
                              <span className="text-red-500 font-normal"> ({report.danger.bestPitch.detail})</span>
                            </p>
                          )}
                        </>
                      ) : <p className="text-red-900 text-[15px] mt-1">No hits recorded yet</p>}
                    </div>
                  </div>

                  {/* ── 1st Pitch / 2nd Pitch ── */}
                  {(report.first.atBats > 0 || report.second.atBats > 0) && (
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      {[report.first, report.second].map(read => (
                        <div key={read.label} className="rounded-xl p-3 border" style={{ background: '#07101c', borderColor: '#1e3a5f' }}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-blue-400 text-[13px] font-bold uppercase tracking-wide">{read.label}</span>
                            <span className="text-slate-500 text-[13px]">{read.atBats} AB</span>
                          </div>
                          {read.atBats === 0 ? (
                            <p className="text-slate-700 text-[14px] text-center py-1">—</p>
                          ) : (
                            <>
                              <p className="text-slate-300 text-[14px]">Swings {read.swings} of {read.atBats} ({read.swingPct}%)</p>
                              <p className={`text-[15px] font-bold leading-snug mt-1 ${read.tone === 'attack' ? 'text-emerald-400' : read.tone === 'careful' ? 'text-amber-400' : 'text-slate-400'}`}>
                                {read.advice}
                              </p>
                              {read.strikeGetter && (
                                <div className="mt-1.5 px-1.5 py-1 rounded-lg bg-slate-800 border border-slate-700">
                                  <p className="text-[12px] text-slate-500 uppercase tracking-wide">Gets strikes</p>
                                  <p className="text-[14px] leading-tight">
                                    <span className="font-black" style={{ color: PT_COLOR[read.strikeGetter.type] ?? '#94a3b8' }}>{PT_LABEL[read.strikeGetter.type] ?? read.strikeGetter.type}</span>
                                    <span className="text-slate-300"> {read.strikeGetter.zone}</span>
                                  </p>
                                  <p className="text-[13px] text-emerald-400">{read.strikeGetter.detail}</p>
                                </div>
                              )}
                              <div className="space-y-[3px] mt-1.5">
                                {read.recent.map((p, i) => (
                                  <div key={i} className="flex items-center gap-1">
                                    <span className="text-[14px] font-black w-7 shrink-0" style={{ color: PT_COLOR[p.pitchType ?? ''] ?? '#94a3b8' }}>
                                      {PT_LABEL[p.pitchType ?? ''] ?? p.pitchType}
                                    </span>
                                    <span className="text-slate-500 text-[13px] flex-1 truncate">{pitchLocShort(p.pitchLocation, p.batterHand, gridHand)}</span>
                                    <span className="text-[13px] font-semibold" style={{ color: OUTCOME_CLR_MAP[p.outcome ?? ''] ?? '#94a3b8' }}>
                                      {p.outcome === 'in-play' && p.hitResult ? (RES_LABEL[p.hitResult] ?? p.hitResult) : (OUTCOME_SHORT_MAP[p.outcome ?? ''] ?? p.outcome)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Where He Does Damage — hits / balls in play per strike zone */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                    <p className="text-slate-500 text-[13px] uppercase tracking-widest mb-2.5 text-center">Where He Does Damage</p>
                    <div className="flex items-stretch gap-1.5">
                      {gridHand === 'R' && (
                        <div className="flex items-stretch">
                          <BatSVG />
                        </div>
                      )}
                      <div className="flex-1 rounded-lg border border-slate-600 overflow-hidden">
                        <div className="grid grid-cols-3" style={{ gap: 0 }}>
                          {[1,2,3,4,5,6,7,8,9].map(n => {
                            const zk = `Z${n}`;
                            const d = report.damage.zones[zk];
                            const bases = d?.bases ?? 0;
                            const borderAlpha = bases === 0 ? 0 : bases === 1 ? 0.4 : bases <= 3 ? 0.7 : 1.0;
                            return (
                              <div key={zk}
                                className="flex flex-col items-center justify-center select-none"
                                style={{
                                  background: bases > 0 ? '#1c1100' : '#090d18',
                                  minHeight: 108,
                                  padding: '8px 4px',
                                  gap: 4,
                                  outline: bases > 0 ? `2px solid rgba(234,179,8,${borderAlpha})` : 'none',
                                  outlineOffset: '-2px',
                                  borderRight:  n % 3 === 0 ? 'none' : '1px solid rgba(148,163,184,0.18)',
                                  borderBottom: n > 6 ? 'none' : '1px solid rgba(148,163,184,0.18)',
                                }}>
                                {d ? (
                                  <>
                                    <span className="leading-none" style={{ fontSize: 24 }}>
                                      <span className={`font-black ${d.hits > 0 ? 'text-white' : 'text-slate-500'}`}>{d.hits}</span>
                                      <span className="text-slate-500 font-bold" style={{ fontSize: 15 }}>/{d.bip}</span>
                                    </span>
                                    <div className="flex flex-col items-center" style={{ gap: 2, width: '100%' }}>
                                      {d.rows.map(({ type, results, topSpot }) => (
                                        <div key={type} className="flex items-center justify-center flex-wrap" style={{ gap: 3 }}>
                                          <span className="font-black leading-none" style={{ fontSize: 13, color: PT_COLOR[type] ?? '#94a3b8' }}>{PT_LABEL[type] ?? type}</span>
                                          {RES_ORDER.filter(r => results[r]).map(r => (
                                            <span key={r} className="font-bold leading-none" style={{ fontSize: 13, color: RES_COLOR[r] ?? '#94a3b8' }}>
                                              {RES_LABEL[r]}{results[r] > 1 ? `×${results[r]}` : ''}
                                            </span>
                                          ))}
                                          {topSpot && (
                                            <span className="leading-none" style={{ fontSize: 12, color: 'rgba(148,163,184,0.6)' }}>{HZ_ABBR[topSpot] ?? topSpot}</span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </>
                                ) : (
                                  <span style={{ fontSize: 18, color: 'rgba(100,116,139,0.15)' }}>·</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      {gridHand === 'L' && (
                        <div className="flex items-stretch">
                          <BatSVG />
                        </div>
                      )}
                    </div>
                    {report.damage.outOfZone.bip > 0 && (
                      <p className="text-slate-400 text-[14px] text-center mt-2">
                        Off the plate: <span className={report.damage.outOfZone.hits > 0 ? 'text-amber-300 font-bold' : ''}>{report.damage.outOfZone.hits}/{report.damage.outOfZone.bip}</span>
                        {Object.keys(report.damage.outOfZone.byDir).length > 0 && (
                          <> · hits on {Object.entries(report.damage.outOfZone.byDir).map(([d, n]) => `${({ High: 'high', Low: 'low', In: 'inside', Out: 'away' } as Record<string, string>)[d]} ×${n}`).join(', ')}</>
                        )}
                      </p>
                    )}
                    <p className="text-slate-600 text-[12px] text-center mt-1">hits / balls in play per zone · gold = hits (errors not counted)</p>
                  </div>
                </div>

              </div>
            )}

            {/* ══════════ SPRAY VIEW ══════════ */}
            {view === 'spray' && (
              <div className="px-4">
                <p className="text-slate-500 text-[14px] uppercase tracking-widest mb-3">Spray Chart — Balls in Play ({hits.length})</p>
                <svg viewBox={`0 0 ${SW} ${SH}`} className="w-full rounded-2xl" style={{ background: '#0a140a' }}>
                  <path d={`M ${SHX} ${SHY} L ${SLFPX} ${SLFPY} A ${SR_FENCE} ${SR_FENCE} 0 0 1 ${SRFPX} ${SRFPY} Z`} fill="#7a5c3a" />
                  <path d={`M ${SHX} ${SHY} L ${SWARN_LX} ${SWARN_LY} A ${SR_WARN} ${SR_WARN} 0 0 1 ${SWARN_RX} ${SWARN_RY} Z`} fill="#173d10" />
                  <path d={`M ${SHX} ${SHY} L ${SB1X} ${SB1Y} L ${SB2X} ${SB2Y} L ${SB3X} ${SB3Y} Z`} fill="#1e5216" />
                  <path d={`M ${SHX} ${SHY} L ${SB1X} ${SB1Y} L ${SB2X} ${SB2Y} L ${SB3X} ${SB3Y} Z`} fill="#7a5230" opacity="0.45" />
                  <path d={`M ${SLFPX} ${SLFPY} A ${SR_FENCE} ${SR_FENCE} 0 0 1 ${SRFPX} ${SRFPY}`} fill="none" stroke="#e5a020" strokeWidth="2.5" opacity="0.85" />
                  <line x1={SHX} y1={SHY} x2={SLFPX} y2={SLFPY} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />
                  <line x1={SHX} y1={SHY} x2={SRFPX} y2={SRFPY} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />
                  <circle cx={SMX} cy={SMY} r="9" fill="#9B6E4C" opacity="0.8" />
                  <circle cx={SMX} cy={SMY} r="2" fill="#ccc" opacity="0.9" />
                  {([
                    [SHX, SHY, 'H', false],
                    [SB1X, SB1Y, '1', true],
                    [SB2X, SB2Y, '2', true],
                    [SB3X, SB3Y, '3', true],
                  ] as [number, number, string, boolean][]).map(([x, y, l, rotate]) => (
                    <g key={l}>
                      <rect x={x-9} y={y-9} width="18" height="18" fill={l==='H'?'#d4c5a0':'white'} rx="2" transform={rotate?`rotate(45 ${x} ${y})`:undefined} />
                      <text x={x} y={y+4} textAnchor="middle" fontSize="14" fontWeight="bold" fill="#0a140a">{l}</text>
                    </g>
                  ))}
                  {hits.length === 0
                    ? <text x={SW/2} y={SH/2} textAnchor="middle" fontSize="18" fill="#475569">No hit data yet</text>
                    : hits.map((p, i) => {
                        const x = (Number(p.hitX) / 100) * SW;
                        const y = (Number(p.hitY) / 100) * SH;
                        const c = hitDotColor(p.hitResult ?? '');
                        return (
                          <g key={i}>
                            <circle cx={x} cy={y} r="10" fill={c} opacity="0.8" />
                            <circle cx={x} cy={y} r="10" fill="none" stroke="white" strokeWidth="1.5" opacity="0.6" />
                          </g>
                        );
                      })
                  }
                </svg>
                <div className="mt-2 flex gap-4 flex-wrap items-center">
                  {[{color:'#14b8a6',label:'Hit'},{color:'#64748b',label:'Out'},{color:'#eab308',label:'HR'},{color:'#f59e0b',label:'Error'}].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                      <span className="text-slate-400 text-[15px]">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
