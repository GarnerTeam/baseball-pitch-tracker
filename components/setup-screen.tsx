'use client';
import { UserButton } from '@clerk/nextjs';
import { useState } from 'react';

interface SetupScreenProps {
  onStart: (homeTeam: string, visitingTeam: string) => void;
  webhookUrl: string;
  onSetWebhookUrl: (url: string) => void;
}

export function SetupScreen({ onStart, webhookUrl, onSetWebhookUrl }: SetupScreenProps) {
  const [home, setHome]         = useState('');
  const [visiting, setVisiting] = useState('');
  const [urlInput, setUrlInput] = useState(webhookUrl ?? '');
  const [editingUrl, setEditingUrl] = useState(!webhookUrl);

  const isConnected = !!webhookUrl?.trim();
  const canStart    = home.trim().length > 0 && visiting.trim().length > 0;

  function handleSaveUrl() {
    const trimmed = urlInput.trim();
    onSetWebhookUrl(trimmed);
    setEditingUrl(false);
  }

  function handleStart() {
    if (!canStart) return;
    // Save any pending URL before starting
    if (urlInput.trim() !== webhookUrl) {
      onSetWebhookUrl(urlInput.trim());
    }
    onStart(home.trim(), visiting.trim());
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5">

        {/* ── Header ── */}
        <div className="text-center pb-1">
          <div className="text-[60px] mb-2">⚾</div>
          <h1 className="text-[39px] font-bold tracking-tight">On the Bump</h1>
          <p className="text-slate-400 text-[18px] mt-1">Coach's pitch tracking tool</p>
        </div>

        {/* ── Data Backup Section ── */}
        <div className={`rounded-2xl border ${isConnected && !editingUrl ? 'border-emerald-700 bg-emerald-950/40' : 'border-amber-700 bg-amber-950/30'} overflow-hidden`}>

          {/* Header row */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[21px]">{isConnected && !editingUrl ? '✅' : '⚠️'}</span>
              <span className={`text-[18px] font-bold ${isConnected && !editingUrl ? 'text-emerald-300' : 'text-amber-300'}`}>
                {isConnected && !editingUrl ? 'Data Backup Connected' : 'Data Backup Required'}
              </span>
            </div>
            {isConnected && !editingUrl && (
              <button
                onClick={() => setEditingUrl(true)}
                className="text-slate-500 hover:text-slate-300 text-[15px] underline"
              >
                Change
              </button>
            )}
          </div>

          {/* Connected state — collapsed */}
          {isConnected && !editingUrl && (
            <div className="px-4 pb-3">
              <p className="text-emerald-400/80 text-[15px]">
                Every pitch saves automatically to your Google Sheet. Your data is safe even if your browser closes.
              </p>
            </div>
          )}

          {/* Not connected OR editing — show input */}
          {(!isConnected || editingUrl) && (
            <div className="px-4 pb-4 space-y-3">
              <p className="text-amber-200/80 text-[15px] leading-snug">
                Without this, game data is only stored on this device. A browser refresh or phone crash <span className="font-bold text-amber-300">will permanently erase your data.</span>
              </p>

              {/* PDF instructions link */}
              <a
                href="https://galaxy-prod.tlcdn.com/gen/user_36WGxyCD8MIKwlVSJacTZnpAQVO/07812bbc-6846-4ea8-9ec9-8980e8106254.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-blue-400 text-[15px] font-medium hover:text-blue-300 transition-colors"
              >
                <span className="text-[18px]">📄</span>
                <span className="underline">Setup Instructions (PDF)</span>
              </a>

              {/* URL input */}
              <div className="space-y-2">
                <p className="text-slate-400 text-[15px]">Paste your Google Sheets webhook URL:</p>
                <input
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="https://script.google.com/macros/s/..."
                  className="w-full h-10 rounded-xl bg-slate-800 border border-slate-600 text-slate-100 px-3 text-[13px] outline-none focus:border-blue-500 transition-colors placeholder:text-slate-600"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveUrl}
                    disabled={!urlInput.trim()}
                    className="flex-1 h-9 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-[16px] font-semibold transition-colors"
                  >
                    Connect
                  </button>
                  {editingUrl && isConnected && (
                    <button
                      onClick={() => { setUrlInput(webhookUrl); setEditingUrl(false); }}
                      className="px-4 h-9 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-[16px] transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* Skip warning */}
              {!isConnected && (
                <p className="text-slate-600 text-[13px] text-center">
                  You can still start a game without backup — at your own risk.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Team Entry Card ── */}
        <div className="bg-slate-900 rounded-2xl border border-slate-700 overflow-hidden">

          <div className="px-4 pt-4 pb-3">
            <label className="block text-[16px] font-bold uppercase tracking-widest text-emerald-400 mb-2">
              🏠 My Team
            </label>
            <input
              value={home}
              onChange={e => setHome(e.target.value)}
              placeholder="e.g. Rockets"
              className="w-full h-11 rounded-xl bg-slate-800 border border-slate-600 text-slate-100 px-4 text-[21px] font-medium outline-none focus:border-emerald-500 transition-colors placeholder:text-slate-600"
            />
          </div>

          <div className="flex items-center px-4 py-1">
            <div className="flex-1 h-px bg-slate-700" />
            <span className="text-slate-600 text-[16px] px-3">vs</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>

          <div className="px-4 pt-1 pb-4">
            <label className="block text-[16px] font-bold uppercase tracking-widest text-blue-400 mb-2">
              ✈ Opposing Team Name
            </label>
            <input
              value={visiting}
              onChange={e => setVisiting(e.target.value)}
              placeholder="Opposing team name"
              onKeyDown={e => { if (e.key === 'Enter' && canStart) handleStart(); }}
              className="w-full h-11 rounded-xl bg-slate-800 border border-slate-600 text-slate-100 px-4 text-[21px] font-medium outline-none focus:border-blue-500 transition-colors placeholder:text-slate-600"
            />
          </div>
        </div>

        {/* Preview */}
        {canStart && (
          <p className="text-center text-slate-400 text-[18px]">
            <span className="text-emerald-300 font-semibold">{home.trim()}</span>
            <span className="text-slate-600 mx-2">vs</span>
            <span className="text-blue-300 font-semibold">{visiting.trim()}</span>
          </p>
        )}

        {/* Start button */}
        <div className="space-y-2">
          <button
            onClick={handleStart}
            disabled={!canStart}
            className={`w-full h-13 rounded-2xl text-[24px] font-bold transition-all py-3 ${
              !canStart
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                : isConnected
                  ? 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/40'
                  : 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/40'
            }`}
          >
            {!canStart ? '⚾ Start Game' : isConnected ? '⚾ Start Game' : '⚠️ Start Without Backup'}
          </button>

          {!isConnected && canStart && (
            <p className="text-center text-amber-600/70 text-[13px]">
              Data will only be saved on this device
            </p>
          )}
        </div>

        <p className="text-center text-slate-600 text-[15px]">
          Pitcher and batting lineup are added on the Lineup tab
        </p>

      </div>
    </div>
  );
}
