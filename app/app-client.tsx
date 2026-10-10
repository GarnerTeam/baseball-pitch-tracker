'use client';
import { useState } from 'react';
import { UserButton } from '@clerk/nextjs';
import { useGame } from '@/hooks/use-game';
import { useViewportHeight } from '@/hooks/use-viewport-height';
import { GameState } from '@/types';
import { SetupScreen } from '@/components/setup-screen';
import { PitchScreen } from '@/components/pitch-screen';
import { HitScreen } from '@/components/hit-screen';
import { LineupPanel } from '@/components/lineup-panel';
import { HistoryLineupView } from '@/components/history-lineup-view';
import { AnalyticsScreen } from '@/components/analytics-screen';
import { GameLog } from '@/components/game-log';
import { NotificationToast } from '@/components/notification-toast';
import { PastGamesBrowser } from '@/components/past-games-browser';
import { PlayerProfileScreen } from '@/components/player-profile-screen';
import { EndGameModal } from '@/components/end-game-modal';
import { loadResumableGame, loadReadOnlyGame, pitchCountOf, atBatCountOf } from '@/lib/games';
import { useOrganization, useUser } from '@clerk/nextjs';

const NAV_TABS = [
  { id: 'pitch' as const, label: 'Pitch', icon: '⚾' },
  { id: 'lineup' as const, label: 'Lineup', icon: '👥' },
  { id: 'analytics' as const, label: 'Stats', icon: '📊' },
  { id: 'log' as const, label: 'Log', icon: '📋' },
];

// Past games are read-only — no Pitch tab, since the game is already completed.
const HISTORY_NAV_TABS = NAV_TABS.filter(t => t.id !== 'pitch');

export default function App() {
  const { state, actions, syncStatus, gameSave, endGame, resumeGame } = useGame();
  // Keeps --app-vh in sync with the real live viewport — fixes a WebKit
  // lag where 100dvh doesn't recompute fast enough after an in-app screen
  // swap (e.g. Past Games -> a specific game), leaving fixed header/nav
  // controls briefly unreachable under the browser's own chrome. See
  // hooks/use-viewport-height.ts and the .h-app class in globals.css.
  useViewportHeight();

  // Historical (read-only) game being viewed — entirely separate from the
  // live useGame() state, so browsing past games can NEVER touch or clobber
  // the in-progress game a coach may be actively tracking.
  const [historyState, setHistoryState] = useState<GameState | null>(null);
  const [historyTab, setHistoryTab] = useState<'lineup' | 'analytics' | 'log'>('lineup');
  const [showPastGames, setShowPastGames] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  // Player Profile Management is scoped to the Organization, same as
  // Lineup-tab autocomplete (see components/lineup-panel.tsx).
  const { organization } = useOrganization();
  const { user } = useUser();
  const ownerId = organization?.id ?? user?.id ?? '';

  // End Game — the numbers are captured when it opens, because the live
  // game is cleared as soon as it's saved.
  const [endInfo, setEndInfo] = useState<{ pitches: number; atBats: number; waiting: number; homeTeam: string; visitingTeam: string } | null>(null);
  function openEndGame() {
    setEndInfo({
      pitches: pitchCountOf(state), atBats: atBatCountOf(state), waiting: state.syncQueue.length,
      homeTeam: state.homeTeam, visitingTeam: state.visitingTeam,
    });
  }

  async function viewGame(gameId: string) {
    try {
      const gs = await loadReadOnlyGame(gameId);
      if (gs) { setHistoryState(gs); setHistoryTab('lineup'); }
    } catch { /* stays on the start screen */ }
  }

  /** Resume from the start screen or Past Games. Resolves to an error message or null. */
  async function handleResume(gameId: string, knownStatus = ''): Promise<string | null> {
    if (state.phase !== 'setup' && gameId === state.id) {
      setShowPastGames(false);
      setHistoryState(null);
      return null;
    }
    let loaded;
    try {
      loaded = await loadResumableGame(gameId);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    const status = knownStatus || loaded.status;
    if (status === 'final' && !confirm('This game was ended. Reopen it and keep tracking?')) return null;
    if (loaded.rebuilt && !confirm('This game was recorded before games were saved, so it will be rebuilt from its pitches. Check the outs, runners and current batter before you continue.')) return null;
    if (state.phase !== 'setup' && pitchCountOf(state) + state.lineup.filter(p => p.name.trim()).length > 0
        && !confirm(`Switch games? ${state.homeTeam || 'Home'} vs ${state.visitingTeam || 'Away'} is saved and stays under "Continue a Game" on the start screen.`)) {
      return null;
    }
    const err = await resumeGame(loaded.state, { reopen: true, rebuilt: loaded.rebuilt });
    if (err) return err;
    setShowPastGames(false);
    setHistoryState(null);
    return null;
  }

  const endModal = endInfo && (
    <EndGameModal
      {...endInfo}
      onEnd={endGame}
      onClose={() => setEndInfo(null)}
      onViewGame={(gameId) => { setEndInfo(null); void viewGame(gameId); }}
    />
  );

  if (showPlayers) {
    return (
      <PlayerProfileScreen
        webhookUrl={state.sheetsWebhookUrl}
        ownerId={ownerId}
        onClose={() => setShowPlayers(false)}
      />
    );
  }

  if (showPastGames) {
    return (
      <PastGamesBrowser
        webhookUrl={state.sheetsWebhookUrl}
        currentGameId={state.id}
        onClose={() => setShowPastGames(false)}
        onResumeGame={handleResume}
        onSelectGame={(gs) => {
          setHistoryState(gs);
          setHistoryTab('lineup');
          setShowPastGames(false);
        }}
      />
    );
  }

  if (historyState) {
    return (
      <div className="fixed inset-0 h-dvh h-app bg-slate-950 text-slate-100 flex flex-col">
        {/* Read-only banner — top padding cleared by env(safe-area-inset-top)
            so the Back button is never rendered under a mobile browser's
            own (still-animating) chrome — see hooks/use-viewport-height.ts.
            The 3rem floor is a deliberate hard minimum: in standalone PWA
            mode env(safe-area-inset-top) has been observed reporting 0 on
            some iOS versions even though content genuinely draws under the
            Dynamic Island/notch, so we never rely on env() alone. */}
        <div className="flex-shrink-0 bg-amber-950/60 border-b border-amber-800 px-4 pb-2 flex items-center gap-3" style={{ paddingTop: 'max(3rem, env(safe-area-inset-top))' }}>
          <button
            onClick={() => setHistoryState(null)}
            className="text-amber-300 hover:text-amber-200 text-[15px] font-semibold flex-shrink-0"
          >
            ‹ Back
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-amber-200 text-[15px] font-bold truncate">
              🔒 {historyState.homeTeam || 'Home'} vs {historyState.visitingTeam || 'Away'} — Game Completed
            </p>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {historyTab === 'lineup' && (
            <HistoryLineupView state={historyState} />
          )}
          {historyTab === 'analytics' && <AnalyticsScreen state={historyState} />}
          {historyTab === 'log' && <GameLog state={historyState} />}
        </div>

        <nav className="flex-shrink-0 bg-slate-900 border-t border-slate-800 flex safe-area-inset-bottom">
          {HISTORY_NAV_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setHistoryTab(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors ${historyTab === tab.id ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <span className="text-[27px] leading-none">{tab.icon}</span>
              <span className="text-[15px] font-medium">{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>
    );
  }

  if (state.phase === 'setup') {
    return (
      <>
        <SetupScreen onStart={actions.startGame} webhookUrl={state.sheetsWebhookUrl} onViewPastGames={() => setShowPastGames(true)} onResume={(id) => handleResume(id)} />
        {endModal}
      </>
    );
  }
  if (state.phase === 'hit-mode') {
    return (
      <div className="fixed inset-0 h-dvh pt-safe bg-slate-950 z-50">
        <HitScreen onRecord={actions.recordHit} onCancel={actions.cancelHitMode} />
      </div>
    );
  }
  return (
    <div className="fixed inset-0 h-dvh pt-safe bg-slate-950 text-slate-100 flex flex-col">
      <NotificationToast notification={state.notification} />
      {/* Each tab screen manages its own scroll — parent must NOT clip with overflow-hidden */}
      <div className="flex-1 min-h-0">
        {state.activeTab === 'pitch' && (
          <PitchScreen state={state} onSetPitchType={actions.setPitchType} onSetLocation={actions.setLocation} onSetSwing={actions.setSwing} onSetContact={actions.setContact} onRecordPitch={actions.recordPitch} onNextBatter={actions.nextBatter} onPrevBatter={actions.prevBatter} onUndoPitch={actions.undoPitch} onSetBatterHand={actions.setBatterHand} onToggleOverlay={actions.toggleOverlay} onSetOverlayFilter={actions.setOverlayFilter} onTabChange={actions.setTab} onSetBase={actions.setBase} onSetOuts={actions.setOuts} onHitByPitch={actions.hitByPitch} />
        )}
        {state.activeTab === 'lineup' && (
          <LineupPanel state={state} onNextBatter={actions.nextBatter} onPrevBatter={actions.prevBatter} onEndAtBat={actions.endAtBat} onChangePitcher={actions.changePitcher} onAddBatter={actions.addBatter} onRemoveBatter={actions.removeBatter} onSetBatterAt={actions.setBatterAt} onUndoLastEnd={actions.undoLastEnd} onReorderBatter={actions.reorderBatter} onEditPitch={actions.editPitch} onLoadRoster={actions.loadRoster} syncStatus={syncStatus} gameSave={gameSave} onEndGame={openEndGame} />
        )}
        {state.activeTab === 'analytics' && <AnalyticsScreen state={state} />}
        {state.activeTab === 'log' && <GameLog state={state} />}
      </div>
      <nav className="flex-shrink-0 bg-slate-900 border-t border-slate-800 flex safe-area-inset-bottom">
        {NAV_TABS.map(tab => (
          <button key={tab.id} onClick={() => actions.setTab(tab.id)} className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${state.activeTab === tab.id ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}>
            <span className="text-[22px] leading-none">{tab.icon}</span>
            <span className="text-[12px] font-medium">{tab.label}</span>
          </button>
        ))}
        <button onClick={() => setShowPastGames(true)} className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-slate-500 hover:text-slate-300 transition-colors">
          <span className="text-[22px] leading-none">📂</span>
          <span className="text-[12px] font-medium">History</span>
        </button>
        <button onClick={() => setShowPlayers(true)} className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-slate-500 hover:text-slate-300 transition-colors">
          <span className="text-[22px] leading-none">👤</span>
          <span className="text-[12px] font-medium">Players</span>
        </button>
        <button onClick={openEndGame} className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-rose-400 hover:text-rose-300 transition-colors">
          <span className="text-[22px] leading-none">🏁</span>
          <span className="text-[11px] font-semibold whitespace-nowrap">End Game</span>
        </button>
        <div className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5">
          <UserButton
            appearance={{
              elements: {
                avatarBox: 'w-6 h-6',
                userButtonPopoverCard: 'bg-slate-900 border border-slate-700',
                userButtonPopoverActionButton: 'text-slate-200 hover:bg-slate-800',
                userButtonPopoverActionButtonText: 'text-slate-200',
                userButtonPopoverFooter: 'hidden',
              },
            }}
          />
          <span className="text-[12px] font-medium text-slate-500">Account</span>
        </div>
      </nav>
      {endModal}
    </div>
  );
}
