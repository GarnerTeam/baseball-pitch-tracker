'use client';
import { useState } from 'react';
import type { EndGameResult } from '@/hooks/use-game';

interface EndGameModalProps {
  homeTeam: string;
  visitingTeam: string;
  pitches: number;
  atBats: number;
  /** Pitches recorded but not uploaded yet. */
  waiting: number;
  onEnd: () => Promise<EndGameResult>;
  onClose: () => void;
  /** Opens the just-saved game in the read-only Past Games view. */
  onViewGame: (gameId: string) => void;
}

/**
 * End Game: one clear step that uploads everything, saves the game as
 * finished, and only then clears the device — with a receipt saying how
 * many pitches are stored. If anything fails, the game stays open.
 */
export function EndGameModal({ homeTeam, visitingTeam, pitches, atBats, waiting, onEnd, onClose, onViewGame }: EndGameModalProps) {
  const [step, setStep] = useState<'confirm' | 'saving' | 'done' | 'error'>('confirm');
  const [result, setResult] = useState<EndGameResult | null>(null);

  const matchup = (
    <p className="text-[19px] font-semibold text-center">
      <span className="text-emerald-300">{homeTeam || 'Home'}</span>
      <span className="text-slate-500 mx-2">vs</span>
      <span className="text-blue-300">{visitingTeam || 'Away'}</span>
    </p>
  );

  async function handleEnd() {
    setStep('saving');
    const r = await onEnd();
    setResult(r);
    setStep(r.ok ? 'done' : 'error');
  }

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : w.endsWith('ch') ? 'es' : 's'}`;

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-4 text-slate-100">

        {step === 'confirm' && (
          <>
            <div className="text-center space-y-1">
              <div className="text-[44px] leading-none">🏁</div>
              <h2 className="text-[24px] font-bold">End this game?</h2>
            </div>
            {matchup}
            <div className="rounded-xl bg-slate-800/70 border border-slate-700 px-4 py-3 text-center">
              <p className="text-[18px] font-semibold">{plural(pitches, 'pitch')} · {plural(atBats, 'at-bat')}</p>
              {waiting > 0
                ? <p className="text-amber-300 text-[14px] mt-1">⏳ {plural(waiting, 'pitch')} still uploading — saved first</p>
                : pitches > 0 && <p className="text-emerald-400 text-[14px] mt-1">✓ All pitches uploaded</p>}
            </div>
            <p className="text-slate-400 text-[14px] text-center">
              The game is saved to your account and moves to Past Games. You can reopen it later if you need to.
            </p>
            <button
              onClick={handleEnd}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[20px] font-bold"
            >
              🏁 End &amp; Save Game
            </button>
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[17px] font-medium"
            >
              Keep Tracking
            </button>
          </>
        )}

        {step === 'saving' && (
          <div className="py-8 text-center space-y-3">
            <div className="text-[40px] leading-none animate-pulse">☁️</div>
            <p className="text-[20px] font-semibold">Saving game…</p>
            <p className="text-slate-400 text-[14px]">Uploading pitches and confirming they&apos;re stored.</p>
          </div>
        )}

        {step === 'done' && result && (
          <>
            <div className="text-center space-y-1">
              <div className="text-[48px] leading-none">✅</div>
              <h2 className="text-[24px] font-bold text-emerald-300">Game Saved</h2>
            </div>
            {matchup}
            <div className="rounded-xl bg-emerald-950/40 border border-emerald-700 px-4 py-3 text-center">
              {result.pitches > 0 ? (
                <>
                  <p className="text-[18px] font-semibold text-emerald-200">{plural(result.pitches, 'pitch')} · {plural(result.atBats, 'at-bat')}</p>
                  <p className="text-emerald-400 text-[14px] mt-1">Stored in your account — find it any time in Past Games.</p>
                </>
              ) : (
                <p className="text-[16px] text-emerald-200">No pitches were recorded in this game.</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white text-[20px] font-bold"
            >
              ⚾ Start a New Game
            </button>
            {result.pitches > 0 && (
              <button
                onClick={() => onViewGame(result.gameId)}
                className="w-full py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[17px] font-medium"
              >
                📂 View This Game
              </button>
            )}
          </>
        )}

        {step === 'error' && result && (
          <>
            <div className="text-center space-y-1">
              <div className="text-[44px] leading-none">⚠️</div>
              <h2 className="text-[22px] font-bold text-amber-300">Not saved yet</h2>
            </div>
            {matchup}
            <div className="rounded-xl bg-amber-950/30 border border-amber-700 px-4 py-3 space-y-1">
              <p className="text-slate-200 text-[15px]">
                Your game is still open on this device — nothing has been lost. Check your connection and try again.
              </p>
              {result.error && <p className="text-amber-400/80 text-[12px] break-words">{result.error}</p>}
            </div>
            <button
              onClick={handleEnd}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[19px] font-bold"
            >
              Try Again
            </button>
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[17px] font-medium"
            >
              Keep Tracking
            </button>
          </>
        )}
      </div>
    </div>
  );
}
