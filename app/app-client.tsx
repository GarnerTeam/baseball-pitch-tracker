'use client';
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
  const { state, actions } = useGame();
  if (state.phase === 'setup') return <SetupScreen onStart={actions.startGame} />;
  if (state.phase === 'hit-mode') {
    return (
      <div className="fixed inset-0 bg-slate-950 z-50">
        <HitScreen onRecord={actions.recordHit} onCancel={actions.cancelHitMode} />
      </div>
    );
  }
  return (
    <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col overflow-hidden">
      <NotificationToast notification={state.notification} />
      <div className="flex-1 overflow-hidden">
        {state.activeTab === 'pitch' && (
          <PitchScreen state={state} onSetPitchType={actions.setPitchType} onSetLocation={actions.setLocation} onSetSwing={actions.setSwing} onSetContact={actions.setContact} onRecordPitch={actions.recordPitch} onNextBatter={actions.nextBatter} onResetCount={actions.resetCount} onToggleOverlay={actions.toggleOverlay} onSetOverlayFilter={actions.setOverlayFilter} onTabChange={actions.setTab} />
        )}
        {state.activeTab === 'lineup' && (
          <LineupPanel state={state} onNextBatter={actions.nextBatter} onSkipBatter={actions.skipBatter} onEndAtBat={actions.endAtBat} onChangePitcher={actions.changePitcher} onAddBatter={actions.addBatter} onRemoveBatter={actions.removeBatter} onSetBatterAt={actions.setBatterAt} onSetWebhookUrl={actions.setWebhookUrl} />
        )}
        {state.activeTab === 'analytics' && <AnalyticsScreen state={state} />}
        {state.activeTab === 'log' && <GameLog state={state} />}
      </div>
      <nav className="flex-shrink-0 bg-slate-900 border-t border-slate-800 flex safe-area-inset-bottom">
        {NAV_TABS.map(tab => (
          <button key={tab.id} onClick={() => actions.setTab(tab.id)} className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors ${state.activeTab === tab.id ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}>
            <span className="text-lg leading-none">{tab.icon}</span>
            <span className="text-[10px] font-medium">{tab.label}</span>
          </button>
        ))}
        <button onClick={() => { if (confirm('Start a new game? Data will be cleared.')) actions.newGame(); }} className="flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-slate-500 hover:text-red-400 transition-colors">
          <span className="text-lg leading-none">🔄</span>
          <span className="text-[10px] font-medium">New</span>
        </button>
      </nav>
    </div>
  );
}