'use client';

import { useReducer, useEffect, useCallback, useRef, useState } from 'react';
import {
  GameState, BaseState,
  AtBatSnapshot,
  PitchType,
  PitchLocation,
  SwingResult,
  ContactType,
  AtBat,
  PitchRecord,
  Player,
  HitData,
} from '@/types';
import {
  determinePitchOutcome,
  updateCount,
  isAtBatComplete,
  getAtBatResult,
} from '@/lib/game-engine';
import { syncQueueToSheets, DEFAULT_WEBHOOK_URL } from '@/lib/sheets';

const STORAGE_KEY = 'baseball-pitch-tracker-v1';

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createNewAtBat(batterIndex: number, atBatNumber: number, gameId: string, playerId?: string): AtBat {
  return {
    id: `${gameId}-ab-${genId()}`,
    batterIndex,
    playerId,
    atBatNumber,
    pitches: [],
    balls: 0,
    strikes: 0,
    isComplete: false,
    startedAt: new Date().toISOString(),
  };
}

function getBatterAtBatNumber(allAtBats: AtBat[], batterIndex: number): number {
  return allAtBats.filter((ab) => ab.batterIndex === batterIndex && ab.isComplete).length + 1;
}

function createInitialState(): GameState {
  return {
    id: `game-${genId()}`,
    phase: 'setup',
    homeTeam: '',
    visitingTeam: '',
    pitcher: { id: '', name: '', number: '' },
    lineup: [],
    currentBatterIndex: 0,
    currentAtBat: null,
    allAtBats: [],
    pendingPitch: { pitchType: null, location: null, swing: null, contact: null },
    overlayEnabled: true,
    overlayFilter: 'all',
    activeTab: 'pitch',
    notification: null,
    sheetsWebhookUrl: DEFAULT_WEBHOOK_URL,
    baseState: { first: false, second: false, third: false },
    outsCount: 0 as 0 | 1 | 2,
    syncQueue: [],
    batterHand: null,
    pitcherHistory: [],
  };
}

type GameAction =
  | { type: 'START_GAME'; homeTeam: string; visitingTeam: string }
  | { type: 'SET_BASE'; base: keyof BaseState; occupied: boolean }
  | { type: 'SET_PITCH_TYPE'; pitchType: PitchType }
  | { type: 'SET_LOCATION'; location: PitchLocation }
  | { type: 'SET_SWING'; swing: SwingResult | null }
  | { type: 'SET_CONTACT'; contact: ContactType }
  | { type: 'RECORD_PITCH' }
  | { type: 'RECORD_HIT'; hitData: HitData }
  | { type: 'CANCEL_HIT_MODE' }
  | { type: 'NEXT_BATTER' }
  | { type: 'SKIP_BATTER' }
  | { type: 'ADD_BATTER'; player: Player }
  | { type: 'SET_BATTER_AT'; idx: number; player: Player }
  | { type: 'REMOVE_BATTER'; idx: number }
  | { type: 'CHANGE_PITCHER'; pitcher: Player }
  | { type: 'RESET_COUNT' }
  | { type: 'END_AT_BAT' }
  | { type: 'TOGGLE_OVERLAY' }
  | { type: 'SET_OVERLAY_FILTER'; filter: PitchType | 'all' }
  | { type: 'SET_TAB'; tab: GameState['activeTab'] }
  | { type: 'CLEAR_NOTIFICATION' }
  | { type: 'SET_SHEETS_URL'; url: string }
  | { type: 'MARK_SYNCED'; pitchIds: string[] }
  | { type: 'SET_BATTER_HAND'; hand: 'L' | 'R' | null }
  | { type: 'UNDO_PITCH' }
  | { type: 'PREV_BATTER' }
  | { type: 'NEW_GAME' }
  | { type: 'UNDO_LAST_END' };

function resetPendingPitch(state: GameState) {
  return {
    pitchType: state.pendingPitch.pitchType, // sticky pitch type
    location: null,
    swing: null,
    contact: null,
  };
}

function isOut(ab: AtBat): boolean {
  if (ab.result === 'strikeout') return true;
  if (ab.result === 'in-play') {
    const last = ab.pitches[ab.pitches.length - 1];
    return last?.hitData?.result === 'out';
  }
  return false;
}

function advanceToNextBatter(state: GameState, completedAtBat: AtBat): GameState {
  const updatedAll = [...state.allAtBats, completedAtBat];
  // Guard: empty lineup → stay at 0; NaN currentBatterIndex → reset to 0
  const safeCurrentIdx = (!state.lineup.length || isNaN(state.currentBatterIndex))
    ? 0
    : state.currentBatterIndex;
  const nextIndex = state.lineup.length > 1
    ? (safeCurrentIdx + 1) % state.lineup.length
    : safeCurrentIdx; // 0 or 1-batter lineup: stay on same index
  const nextAtBatNum = getBatterAtBatNumber(updatedAll, nextIndex);
  const nextPlayerId = state.lineup[nextIndex]?.id;
  const wasOut = isOut(completedAtBat);
  const newOutsRaw = wasOut ? state.outsCount + 1 : state.outsCount;
  const sideRetired = newOutsRaw >= 3;
  const newOuts = (sideRetired ? 0 : newOutsRaw) as 0 | 1 | 2;
  const newBases = sideRetired
    ? { first: false, second: false, third: false }
    : state.baseState;
  const sideNotification = sideRetired
    ? { message: '3 Outs — Side Retired! ⚾️', type: 'info' as const }
    : null;

  return {
    ...state,
    currentBatterIndex: nextIndex,
    currentAtBat: createNewAtBat(nextIndex, nextAtBatNum, state.id, nextPlayerId),
    allAtBats: updatedAll,
    phase: 'pitching',
    pendingPitch: resetPendingPitch(state),
    outsCount: newOuts,
    baseState: newBases,
    notification: sideNotification ?? state.notification,
    lastCompletedAtBatSnapshot: {
      previousBatterIndex: safeCurrentIdx,
      completedAtBat,
    } as AtBatSnapshot,
  };
}

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_GAME': {
      const gameId = `game-${genId()}`;
      const firstAB = createNewAtBat(0, 1, gameId);
      return {
        ...createInitialState(),
        id: gameId,
        phase: 'pitching',
        homeTeam: action.homeTeam,
        visitingTeam: action.visitingTeam,
        pitcher: { id: genId(), name: '', number: '' },
        lineup: [],
        currentBatterIndex: 0,
        currentAtBat: firstAB,
        allAtBats: [],
        activeTab: 'lineup',
        sheetsWebhookUrl: state.sheetsWebhookUrl,
        batterHand: null,
        pitcherHistory: [],
      };
    }

    case 'SET_PITCH_TYPE':
      return { ...state, pendingPitch: { ...state.pendingPitch, pitchType: action.pitchType } };

    case 'SET_LOCATION':
      return { ...state, pendingPitch: { ...state.pendingPitch, location: action.location } };

    case 'SET_SWING':
      return {
        ...state,
        pendingPitch: {
          ...state.pendingPitch,
          swing: action.swing,
          contact: (action.swing === 'no-swing' || action.swing === null) ? null : state.pendingPitch.contact,
        },
      };

    case 'SET_CONTACT':
      return { ...state, pendingPitch: { ...state.pendingPitch, contact: action.contact } };

    case 'RECORD_PITCH': {
      const { pendingPitch, currentAtBat } = state;
      if (!pendingPitch.location || !pendingPitch.swing || !currentAtBat || !pendingPitch.pitchType) {
        return state;
      }

      const outcome = determinePitchOutcome(
        pendingPitch.location,
        pendingPitch.swing,
        pendingPitch.contact,
        currentAtBat.balls,
        currentAtBat.strikes
      );

      // Switch to hit mode — pitch record created after hit details
      if (outcome === 'in-play') {
        return { ...state, phase: 'hit-mode', notification: null };
      }

      const { balls: ballsAfter, strikes: strikesAfter } = updateCount(
        currentAtBat.balls,
        currentAtBat.strikes,
        outcome
      );

      const batter = state.lineup[state.currentBatterIndex];
      const pitch: PitchRecord = {
        id: `pitch-${genId()}`,
        gameId: state.id,
        timestamp: new Date().toISOString(),
        pitcherName: state.pitcher.name,
        pitcherNumber: state.pitcher.number,
        batterName: batter?.name ?? '',
        batterNumber: batter?.number ?? '',
        lineupPosition: state.currentBatterIndex,
        atBatNumber: currentAtBat.atBatNumber,
        pitchNumber: currentAtBat.pitches.length + 1,
        ballsBefore: currentAtBat.balls,
        strikesBefore: currentAtBat.strikes,
        ballsAfter,
        strikesAfter,
        pitchType: pendingPitch.pitchType,
        location: pendingPitch.location,
        swing: pendingPitch.swing === 'swing',
        outcome,
        batterHand: state.batterHand,
        baseState: state.baseState,
        outsCount: state.outsCount,
        homeTeam: state.homeTeam,
        visitingTeam: state.visitingTeam,
      };

      const complete = isAtBatComplete(outcome);
      const result = getAtBatResult(outcome);

      const updatedAB: AtBat = {
        ...currentAtBat,
        pitches: [...currentAtBat.pitches, pitch],
        balls: ballsAfter,
        strikes: strikesAfter,
        isComplete: complete,
        result,
        completedAt: complete ? new Date().toISOString() : undefined,
      };

      let notification: GameState['notification'] = null;
      if (outcome === 'walk') {
        notification = { message: `WALK! ${batter?.name} takes first base.`, type: 'walk' };
      } else if (outcome === 'strikeout') {
        notification = { message: `STRIKEOUT! ${batter?.name} is out!`, type: 'strikeout' };
      }

      let next: GameState = {
        ...state,
        currentAtBat: updatedAB,
        pendingPitch: resetPendingPitch(state),
        syncQueue: [...state.syncQueue, pitch],
        notification,
        lastCompletedAtBatSnapshot: undefined, // clear when new pitch recorded in current AB
      };

      if (complete) {
        next = advanceToNextBatter(next, updatedAB);
        next = { ...next, notification };
      }

      return next;
    }

    case 'RECORD_HIT': {
      const { currentAtBat, pendingPitch } = state;
      if (!currentAtBat || !pendingPitch.location || !pendingPitch.pitchType) return state;

      const batter = state.lineup[state.currentBatterIndex];
      const pitch: PitchRecord = {
        id: `pitch-${genId()}`,
        gameId: state.id,
        timestamp: new Date().toISOString(),
        pitcherName: state.pitcher.name,
        pitcherNumber: state.pitcher.number,
        batterName: batter?.name ?? '',
        batterNumber: batter?.number ?? '',
        lineupPosition: state.currentBatterIndex,
        atBatNumber: currentAtBat.atBatNumber,
        pitchNumber: currentAtBat.pitches.length + 1,
        ballsBefore: currentAtBat.balls,
        strikesBefore: currentAtBat.strikes,
        ballsAfter: currentAtBat.balls,
        strikesAfter: currentAtBat.strikes,
        pitchType: pendingPitch.pitchType,
        location: pendingPitch.location,
        swing: true,
        outcome: 'in-play',
        batterHand: state.batterHand,
        hitData: action.hitData,
        baseState: state.baseState,
        outsCount: state.outsCount,
        homeTeam: state.homeTeam,
        visitingTeam: state.visitingTeam,
      };

      const completedAB: AtBat = {
        ...currentAtBat,
        pitches: [...currentAtBat.pitches, pitch],
        isComplete: true,
        result: 'in-play',
        completedAt: new Date().toISOString(),
      };

      const hitLabel =
        action.hitData.result === 'home-run'
          ? 'HOME RUN!'
          : action.hitData.result === 'out'
          ? `Out — ${action.hitData.type.replace('-', ' ')}`
          : action.hitData.result.replace('-', ' ').toUpperCase();

      const notification: GameState['notification'] = { message: hitLabel, type: 'info' };

      let next: GameState = {
        ...state,
        phase: 'pitching',
        currentAtBat: completedAB,
        syncQueue: [...state.syncQueue, pitch],
        notification,
        pendingPitch: resetPendingPitch(state),
      };

      next = advanceToNextBatter(next, completedAB);
      next = { ...next, notification };
      return next;
    }

    case 'CANCEL_HIT_MODE':
      return {
        ...state,
        phase: 'pitching',
        pendingPitch: resetPendingPitch(state),
      };

    case 'NEXT_BATTER':
    case 'SKIP_BATTER':
    case 'END_AT_BAT': {
      if (!state.currentAtBat) return state;
      const ended: AtBat = {
        ...state.currentAtBat,
        isComplete: true,
        result: 'manual-end',
        completedAt: new Date().toISOString(),
      };
      return advanceToNextBatter({ ...state, currentAtBat: ended }, ended);
    }

    case 'UNDO_LAST_END': {
      const snap = state.lastCompletedAtBatSnapshot;
      if (!snap) return state;
      return {
        ...state,
        currentBatterIndex: snap.previousBatterIndex,
        currentAtBat: { ...snap.completedAtBat, isComplete: false, result: undefined, completedAt: undefined },
        allAtBats: state.allAtBats.filter(ab => ab.id !== snap.completedAtBat.id),
        pendingPitch: resetPendingPitch(state),
        phase: 'pitching',
        lastCompletedAtBatSnapshot: undefined,
      };
    }

    case 'REMOVE_BATTER': {
      // Clear the slot instead of splicing — splicing shifts indices and causes
      // later batters to inherit earlier batters' at-bat history.
      const rmIdx = (action as any).idx as number;
      if (rmIdx === state.currentBatterIndex) return state; // can't clear active batter
      const clearedLineup = [...state.lineup];
      clearedLineup[rmIdx] = { id: `empty-${rmIdx}-${genId()}`, name: '', number: '' };
      return { ...state, lineup: clearedLineup };
    }
    case 'ADD_BATTER':
      return { ...state, lineup: [...state.lineup, action.player] };

    case 'SET_BATTER_AT': {
      const newLineup = [...state.lineup];
      if ((action as any).idx < newLineup.length) {
        newLineup[(action as any).idx] = (action as any).player;
      } else {
        // Pad with empty if needed then set
        while (newLineup.length < (action as any).idx) {
          newLineup.push({ id: `empty-${newLineup.length}`, name: '', number: '' });
        }
        newLineup.push((action as any).player);
      }
      // Clamp to 10
      return { ...state, lineup: newLineup.slice(0, 16) };
    }

    case 'PREV_BATTER': {
      if (!state.currentAtBat || state.lineup.length === 0) return state;
      const ended: AtBat = {
        ...state.currentAtBat,
        isComplete: true,
        result: 'manual-end',
        completedAt: new Date().toISOString(),
      };
      const updatedAll = [...state.allAtBats, ended];
      const prevIndex = (state.currentBatterIndex - 1 + state.lineup.length) % state.lineup.length;
      const prevAtBatNum = getBatterAtBatNumber(updatedAll, prevIndex);
      const prevPlayerId = state.lineup[prevIndex]?.id;
      return {
        ...state,
        currentBatterIndex: prevIndex,
        currentAtBat: createNewAtBat(prevIndex, prevAtBatNum, state.id, prevPlayerId),
        allAtBats: updatedAll,
        phase: 'pitching',
        pendingPitch: resetPendingPitch(state),
      };
    }

    case 'CHANGE_PITCHER': {
      // Archive current pitcher to history (if they have a name and aren't already there)
      const prevPitcher = state.pitcher;
      const alreadyInHistory = state.pitcherHistory.some(
        p => p.number === prevPitcher.number && p.name === prevPitcher.name
      );
      const newHistory = (prevPitcher.name.trim() && !alreadyInHistory)
        ? [...state.pitcherHistory, prevPitcher]
        : state.pitcherHistory;
      return { ...state, pitcher: action.pitcher, pitcherHistory: newHistory };
    }

    case 'RESET_COUNT':
      if (!state.currentAtBat) return state;
      return {
        ...state,
        currentAtBat: { ...state.currentAtBat, balls: 0, strikes: 0 },
      };

    case 'TOGGLE_OVERLAY':
      return { ...state, overlayEnabled: !state.overlayEnabled };

    case 'SET_OVERLAY_FILTER':
      return { ...state, overlayFilter: action.filter };

    case 'SET_TAB':
      return { ...state, activeTab: action.tab };

    case 'CLEAR_NOTIFICATION':
      return { ...state, notification: null };

    case 'SET_SHEETS_URL':
      return { ...state, sheetsWebhookUrl: action.url };

    case 'MARK_SYNCED':
      return {
        ...state,
        syncQueue: state.syncQueue.filter((p) => !action.pitchIds.includes(p.id)),
      };

    case 'UNDO_PITCH': {
      if (!state.currentAtBat || state.currentAtBat.pitches.length === 0) return state;
      const pitches = state.currentAtBat.pitches.slice(0, -1);
      const last = pitches[pitches.length - 1];
      const removedId = state.currentAtBat.pitches[state.currentAtBat.pitches.length - 1].id;
      return {
        ...state,
        currentAtBat: {
          ...state.currentAtBat,
          pitches,
          balls: last ? last.ballsAfter : 0,
          strikes: last ? last.strikesAfter : 0,
        },
        syncQueue: state.syncQueue.filter(p => p.id !== removedId),
        notification: null,
      };
    }

    case 'SET_BATTER_HAND': {
      const newHand = (action as any).hand as 'L' | 'R' | null;
      const handLineup = state.lineup.map((p, i) =>
        i === state.currentBatterIndex ? { ...p, hand: newHand } : p
      );
      return { ...state, batterHand: newHand, lineup: handLineup };
    }

    case 'NEW_GAME':
      return { ...createInitialState(), sheetsWebhookUrl: state.sheetsWebhookUrl, pitcherHistory: [] };

    case 'SET_BASE':
      return { ...state, baseState: { ...state.baseState, [action.base]: action.occupied } };


    default:
      return state;
  }
}

export function useGame() {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => {
    if (typeof window === 'undefined') return createInitialState();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as GameState;
        // Always apply the Vercel env var URL if set — overrides any stale cached value
        // Migrate: supply safe defaults for any fields added after first deploy.
        // DO NOT change the storage key — that would wipe existing game data.
        return {
          ...parsed,
          sheetsWebhookUrl: parsed.sheetsWebhookUrl || DEFAULT_WEBHOOK_URL,
          // Fields added in later releases — may be absent in old saves
          homeTeam:                    parsed.homeTeam                    ?? '',
          visitingTeam:                parsed.visitingTeam                ?? '',
          baseState:                   parsed.baseState                   ?? { first: false, second: false, third: false },
          outsCount:                   parsed.outsCount                   ?? 0,
          batterHand:                  parsed.batterHand                  ?? null,
          overlayEnabled:              parsed.overlayEnabled              ?? true,
          syncQueue:                   parsed.syncQueue                   ?? [],
          pitcherHistory:              parsed.pitcherHistory              ?? [],
          lastCompletedAtBatSnapshot:  parsed.lastCompletedAtBatSnapshot  ?? undefined,
          notification:                parsed.notification                ?? null,
        };
      }
    } catch {}
    return createInitialState();
  });

  // Persist state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  // Sync queue when online — isSyncing ref prevents concurrent fetches that
  // would cause the same pitch to be written to Sheets multiple times.
  const isSyncing = useRef(false);
  const [syncStatus, setSyncStatus] = useState<{ ok: boolean; message: string; ts: number } | null>(null);

  useEffect(() => {
    if (state.syncQueue.length === 0 || !state.sheetsWebhookUrl || isSyncing.current) return;
    isSyncing.current = true;
    const snapshot = state.syncQueue;
    setSyncStatus(s => s?.ok === false ? s : null); // clear error when retrying
    syncQueueToSheets(state.sheetsWebhookUrl, snapshot).then(({ synced, error, _urlTail }) => {
      isSyncing.current = false;
      if (synced > 0) {
        const ids = snapshot.slice(0, synced).map((p) => p.id);
        dispatch({ type: 'MARK_SYNCED', pitchIds: ids });
        const urlNote = _urlTail ? ` (…${_urlTail.slice(-15)})` : '';
        setSyncStatus({ ok: true, message: `Synced ${synced} pitch${synced !== 1 ? 'es' : ''}${urlNote}`, ts: Date.now() });
        console.log('[sync] success. url tail:', _urlTail, '| pitches:', synced);
      } else if (error) {
        setSyncStatus({ ok: false, message: error, ts: Date.now() });
        console.error('[sync] error from proxy:', error);
      }
    }).catch((err) => {
      isSyncing.current = false;
      setSyncStatus({ ok: false, message: String(err), ts: Date.now() });
      console.error('[sync] network error:', err);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.syncQueue.length, state.sheetsWebhookUrl]);

  // Auto-dismiss notification
  useEffect(() => {
    if (state.notification) {
      const t = setTimeout(() => dispatch({ type: 'CLEAR_NOTIFICATION' }), 3500);
      return () => clearTimeout(t);
    }
  }, [state.notification]);

  return {
    state,
    syncStatus,
    actions: {
      startGame: useCallback((homeTeam: string, visitingTeam: string) =>
        dispatch({ type: 'START_GAME', homeTeam, visitingTeam }), []),
      setPitchType: useCallback((pitchType: PitchType) =>
        dispatch({ type: 'SET_PITCH_TYPE', pitchType }), []),
      setLocation: useCallback((location: PitchLocation) =>
        dispatch({ type: 'SET_LOCATION', location }), []),
      setSwing: useCallback((swing: SwingResult | null) =>
        dispatch({ type: 'SET_SWING', swing }), []),
      setContact: useCallback((contact: ContactType) =>
        dispatch({ type: 'SET_CONTACT', contact }), []),
      recordPitch: useCallback(() => dispatch({ type: 'RECORD_PITCH' }), []),
      recordHit: useCallback((hitData: HitData) =>
        dispatch({ type: 'RECORD_HIT', hitData }), []),
      cancelHitMode: useCallback(() => dispatch({ type: 'CANCEL_HIT_MODE' }), []),
      nextBatter: useCallback(() => dispatch({ type: 'NEXT_BATTER' }), []),
      prevBatter: useCallback(() => dispatch({ type: 'PREV_BATTER' }), []),
      skipBatter: useCallback(() => dispatch({ type: 'SKIP_BATTER' }), []),
      addBatter: useCallback((player: Player) =>
        dispatch({ type: 'ADD_BATTER', player }), []),
      setBatterAt: useCallback((idx: number, player: Player) =>
        dispatch({ type: 'SET_BATTER_AT', idx, player } as any), []),
      changePitcher: useCallback((pitcher: Player) =>
        dispatch({ type: 'CHANGE_PITCHER', pitcher }), []),
      resetCount: useCallback(() => dispatch({ type: 'RESET_COUNT' }), []),
      endAtBat: useCallback(() => dispatch({ type: 'END_AT_BAT' }), []),
      toggleOverlay: useCallback(() => dispatch({ type: 'TOGGLE_OVERLAY' }), []),
      setOverlayFilter: useCallback((filter: PitchType | 'all') =>
        dispatch({ type: 'SET_OVERLAY_FILTER', filter }), []),
      setTab: useCallback((tab: GameState['activeTab']) =>
        dispatch({ type: 'SET_TAB', tab }), []),
      setBase: useCallback((base: keyof BaseState, occupied: boolean) =>
        dispatch({ type: 'SET_BASE', base, occupied }), []),
      setSheetsUrl: useCallback((url: string) =>
        dispatch({ type: 'SET_SHEETS_URL', url }), []),
      undoPitch: useCallback(() => dispatch({ type: 'UNDO_PITCH' }), []),
      setBatterHand: useCallback((hand: 'L' | 'R' | null) => dispatch({ type: 'SET_BATTER_HAND', hand } as any), []),
      newGame: useCallback(() => dispatch({ type: 'NEW_GAME' }), []),
      undoLastEnd: useCallback(() => dispatch({ type: 'UNDO_LAST_END' }), []),
      removeBatter: useCallback((idx: number) => dispatch({ type: 'REMOVE_BATTER', idx } as any), []),
      setWebhookUrl: useCallback((url: string) => dispatch({ type: 'SET_SHEETS_URL', url }), []),
    },
  };
}
