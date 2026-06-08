'use client';

import { useReducer, useEffect, useCallback } from 'react';
import {
  GameState,
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
import { syncQueueToSheets } from '@/lib/sheets';

const STORAGE_KEY = 'baseball-pitch-tracker-v1';

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createNewAtBat(batterIndex: number, atBatNumber: number, gameId: string): AtBat {
  return {
    id: `${gameId}-ab-${genId()}`,
    batterIndex,
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
    sheetsWebhookUrl: '',
    syncQueue: [],
  };
}

type GameAction =
  | { type: 'START_GAME'; pitcher: Player; lineup: Player[] }
  | { type: 'SET_PITCH_TYPE'; pitchType: PitchType }
  | { type: 'SET_LOCATION'; location: PitchLocation }
  | { type: 'SET_SWING'; swing: SwingResult }
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
  | { type: 'NEW_GAME' };

function resetPendingPitch(state: GameState) {
  return {
    pitchType: state.pendingPitch.pitchType, // sticky pitch type
    location: null,
    swing: null,
    contact: null,
  };
}

function advanceToNextBatter(state: GameState, completedAtBat: AtBat): GameState {
  const updatedAll = [...state.allAtBats, completedAtBat];
  const nextIndex = (state.currentBatterIndex + 1) % state.lineup.length;
  const nextAtBatNum = getBatterAtBatNumber(updatedAll, nextIndex);
  return {
    ...state,
    currentBatterIndex: nextIndex,
    currentAtBat: createNewAtBat(nextIndex, nextAtBatNum, state.id),
    allAtBats: updatedAll,
    phase: 'pitching',
    pendingPitch: resetPendingPitch(state),
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
        pitcher: action.pitcher,
        lineup: action.lineup,
        currentBatterIndex: 0,
        currentAtBat: firstAB,
        allAtBats: [],
        activeTab: 'pitch',
        sheetsWebhookUrl: state.sheetsWebhookUrl,
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
          contact: action.swing === 'no-swing' ? null : state.pendingPitch.contact,
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
        hitData: action.hitData,
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

    case 'REMOVE_BATTER': {
      const newLineup = state.lineup.filter((_, i) => i !== (action as any).idx);
      const newIdx = state.currentBatterIndex >= newLineup.length ? Math.max(0, newLineup.length - 1) : state.currentBatterIndex;
      return { ...state, lineup: newLineup, currentBatterIndex: newIdx };
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
      return { ...state, lineup: newLineup.slice(0, 10) };
    }

    case 'CHANGE_PITCHER':
      return { ...state, pitcher: action.pitcher };

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

    case 'NEW_GAME':
      return { ...createInitialState(), sheetsWebhookUrl: state.sheetsWebhookUrl };

    default:
      return state;
  }
}

export function useGame() {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => {
    if (typeof window === 'undefined') return createInitialState();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved) as GameState;
    } catch {}
    return createInitialState();
  });

  // Persist state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  // Sync queue when online
  useEffect(() => {
    if (state.syncQueue.length > 0 && state.sheetsWebhookUrl) {
      syncQueueToSheets(state.sheetsWebhookUrl, state.syncQueue).then(({ synced }) => {
        if (synced > 0) {
          const ids = state.syncQueue.slice(0, synced).map((p) => p.id);
          dispatch({ type: 'MARK_SYNCED', pitchIds: ids });
        }
      });
    }
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
    actions: {
      startGame: useCallback((pitcher: Player, lineup: Player[]) =>
        dispatch({ type: 'START_GAME', pitcher, lineup }), []),
      setPitchType: useCallback((pitchType: PitchType) =>
        dispatch({ type: 'SET_PITCH_TYPE', pitchType }), []),
      setLocation: useCallback((location: PitchLocation) =>
        dispatch({ type: 'SET_LOCATION', location }), []),
      setSwing: useCallback((swing: SwingResult) =>
        dispatch({ type: 'SET_SWING', swing }), []),
      setContact: useCallback((contact: ContactType) =>
        dispatch({ type: 'SET_CONTACT', contact }), []),
      recordPitch: useCallback(() => dispatch({ type: 'RECORD_PITCH' }), []),
      recordHit: useCallback((hitData: HitData) =>
        dispatch({ type: 'RECORD_HIT', hitData }), []),
      cancelHitMode: useCallback(() => dispatch({ type: 'CANCEL_HIT_MODE' }), []),
      nextBatter: useCallback(() => dispatch({ type: 'NEXT_BATTER' }), []),
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
      setSheetsUrl: useCallback((url: string) =>
        dispatch({ type: 'SET_SHEETS_URL', url }), []),
      newGame: useCallback(() => dispatch({ type: 'NEW_GAME' }), []),
      removeBatter: useCallback((idx: number) => dispatch({ type: 'REMOVE_BATTER', idx } as any), []),
      setWebhookUrl: useCallback((url: string) => dispatch({ type: 'SET_SHEETS_URL', url }), []),
    },
  };
}
