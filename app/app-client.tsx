'use client';
import { UserButton } from '@clerk/nextjs';
import { useGame } from '@/hooks/use-game';
import { SetupScreen } from '@/components/setup-screen';
import { PitchScreen } from '@/components/pitch-screen';
import { HitScreen } from '@/components/hit-screen';
import { LineupPanel } from '@/components/lineup-panel';
import { AnalyticsScreen } from '@/components/analytics-screen';
import { GameLog } from '@/components/game-log';
import { NotificationToast } from '@/components/notification-toast';

const NAV_TABS = [
  { id: 'pitch' as const, label: 'Pitch', icon: '⚾' },
  { id: 'lineup' as const, label: 'Lineup', icon: '👥' },
  { id: 'analytics' as const, label: 'Stats', icon: '📊' },
  { id: 'log' as const, label: 'Log', icon: '📋' },
];

export default function App() {
  const { state, actions, syncStatus } = useGame();
  if (state.phase === 'setup') return <SetupScreen onStart={actions.startGame} webhookUrl={state.sheetsWebhookUrl} onSetWebhookUrl={actions.setSheetsUrl} />;
  if (state.phase === 'hit-mode') {
    return (
      <div className="fixed inset-0 bg-slate-950 z-50">
        <HitScreen onRecord={actions.recordHit} onCancel={actions.cancelHitMode} />
      </div>
    );
  }
  return (
    <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col">
      <NotificationToast notification={state.notification} />
      {/* Each tab screen manages its own scroll — parent must NOT clip with overflow-hidden */}
      <div className="flex-1 min-h-0">
        {state.activeTab === 'pitch' && (
          <PitchScreen state={state} onSetPitchType={actions.setPitchType} onSetLocation={actions.setLocation} onSetSwing={actions.setSwing} onSetContact={actions.setContact} onRecordPitch={actions.recordPitch} onNextBatter={actions.nextBatter} onPrevBatter={actions.prevBatter} onUndoPitch={actions.undoPitch} onSetBatterHand={actions.setBatterHand} onToggleOverlay={actions.toggleOverlay} onSetOverlayFilter={actions.setOverlayFilter} onTabChange={actions.setTab} onSetBase={actions.setBase} />
        )}
        {state.activeTab === 'lineup' && (
          <LineupPanel state={state} onNextBatter={actions.nextBatter} onPrevBatter={actions.prevBatter} onEndAtBat={actions.endAtBat} onChangePitcher={actions.changePitcher} onAddBatter={actions.addBatter} onRemoveBatter={actions.removeBatter} onSetBatterAt={actions.setBatterAt} onUndoLastEnd={actions.undoLastEnd} onSetWebhookUrl={actions.setSheetsUrl} syncStatus={syncStatus} />
        )}
        {state.activeTab === 'analytics' && <AnalyticsScreen state={state} />}
        {state.activeTab === 'log' && <GameLog state={state} />}
      </div>
      <nav className="flex-shrink-0 bg-slate-900 border-t border-slate-800 flex safe-area-inset-bottom">
        {NAV_TABS.map(tab => (
          <button key={tab.id} onClick={() => actions.setTab(tab.id)} className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors ${state.activeTab === tab.id ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}>
            <span className="text-[27px] leading-none">{tab.icon}</span>
            <span className="text-[15px] font-medium">{tab.label}</span>
          </button>
        ))}
        <button onClick={() => { if (confirm('Start a new game? Data will be cleared.')) actions.newGame(); }} className="flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-slate-500 hover:text-red-400 transition-colors">
          <span className="text-[27px] leading-none">🔄</span>
          <span className="text-[15px] font-medium">New</span>
        </button>
        <div className="flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5">
          <UserButton
            appearance={{
              elements: {
                avatarBox: 'w-7 h-7',
                userButtonPopoverCard: 'bg-slate-900 border border-slate-700',
                userButtonPopoverActionButton: 'text-slate-200 hover:bg-slate-800',
                userButtonPopoverActionButtonText: 'text-slate-200',
                userButtonPopoverFooter: 'hidden',
              },
            }}
          />
          <span className="text-[15px] font-medium text-slate-500">Account</span>
        </div>
      </nav>
    </div>
  );
}
