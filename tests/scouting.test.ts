/** Baseball sense checks for the History & Tendencies read-outs (lib/scouting.ts). */
import { describe, it, expect } from 'vitest';
import { analyzeBatter, classify, cellVerdict, locationKey, zoneName, type ScoutPitch } from '@/lib/scouting';

let ts = 0;
const P = (over: Partial<ScoutPitch>): ScoutPitch => ({
  gameId: 'g1', timestamp: new Date(Date.UTC(2026, 9, 1, 18, 0, ++ts)).toISOString(),
  batterHand: 'R', pitchType: 'FB', pitchZone: 'Strike', pitchLocation: 'Z5', action: 'Look', outcome: 'ball',
  atBatNumber: 1, pitchNumber: 1, ballsBefore: 0, strikesBefore: 0, ...over,
});
const whiff = (o: Partial<ScoutPitch> = {}) => P({ action: 'Swing', outcome: 'swinging-strike', ...o });
const called = (o: Partial<ScoutPitch> = {}) => P({ action: 'Look', outcome: 'called-strike', ...o });
const foul = (o: Partial<ScoutPitch> = {}) => P({ action: 'Swing', outcome: 'foul', ...o });
const hit = (res: string, o: Partial<ScoutPitch> = {}) => P({ action: 'Swing', outcome: 'in-play', hitResult: res, ...o });
const ball = (o: Partial<ScoutPitch> = {}) => P({ action: 'Look', outcome: 'ball', pitchZone: 'Ball', pitchLocation: 'B-Low', ...o });

describe('pitch classification', () => {
  it('swinging and looking strikeouts, fouls, outs and hits', () => {
    expect(classify(P({ action: 'Swing', outcome: 'strikeout' }))).toMatchObject({ whiff: true, win: true, strikeout: true });
    expect(classify(P({ action: 'Look', outcome: 'strikeout' }))).toMatchObject({ calledStrike: true, whiff: false, win: true });
    expect(classify(foul())).toMatchObject({ foul: true, win: true, hit: false });
    expect(classify(hit('out'))).toMatchObject({ inPlayOut: true, win: true });
    expect(classify(hit('double'))).toMatchObject({ hit: true, bases: 2, win: false });
    expect(classify(hit('error'))).toMatchObject({ hit: false, win: false, inPlay: true });
  });
});

describe('heat map', () => {
  it('a zone full of whiffs is ours (green), not red', () => {
    expect(cellVerdict(analyzeBatter([whiff(), whiff(), foul()]).zones.Z5)).toBe('win');
  });
  it('one homer outweighs a couple of fouls; a lone single among outs stays green', () => {
    expect(cellVerdict(analyzeBatter([foul(), foul(), hit('home-run')]).zones.Z5)).toBe('damage');
    expect(cellVerdict(analyzeBatter([hit('out'), hit('out'), hit('out'), hit('double')]).zones.Z5)).toBe('win');
  });
  it('a switch hitter\'s inside pitch stays inside', () => {
    // Z1 is inside to a righty but away to a lefty: drawn on a righty chart it moves to Z3.
    expect(locationKey('Z1', 'L', 'R')).toBe('Z3');
    expect(locationKey('Z1', 'R', 'R')).toBe('Z1');
    expect(zoneName('Z1', 'R')).toBe('Up-In');
    expect(zoneName('Z1', 'L')).toBe('Up-Away');
    expect(zoneName('B-Low-Out', 'R')).toBe('Low & Away (ball)');
  });
});

describe('Game Plan', () => {
  it('Pitch Here skips a whiff-heavy zone where he also homered, and needs 3 pitches', () => {
    const r = analyzeBatter([
      whiff({ pitchLocation: 'Z1' }), whiff({ pitchLocation: 'Z1' }), hit('home-run', { pitchLocation: 'Z1' }),
      called({ pitchLocation: 'Z9' }), called({ pitchLocation: 'Z9' }), hit('out', { pitchLocation: 'Z9' }), ball({ pitchLocation: 'Z9', pitchZone: 'Strike' }),
      whiff({ pitchLocation: 'Z3' }), whiff({ pitchLocation: 'Z3' }), // only 2 pitches
    ]);
    expect(r.pitchHere?.key).toBe('Z9');
    expect(r.pitchHere?.name).toBe('Down-Away');
    expect(r.pitchHere?.detail).toBe('3 of 4 strikes/outs · no hits');
  });

  it('Put-away pitch is the one that finishes him, not the one thrown most', () => {
    const r = analyzeBatter([
      ...Array.from({ length: 6 }, () => P({ pitchType: 'FB', strikesBefore: 2, action: 'Swing', outcome: 'foul' })),
      P({ pitchType: 'FB', strikesBefore: 2, action: 'Swing', outcome: 'strikeout' }),
      P({ pitchType: 'CB', strikesBefore: 2, action: 'Swing', outcome: 'strikeout', pitchLocation: 'B-Low', pitchZone: 'Ball' }),
      P({ pitchType: 'CB', strikesBefore: 2, action: 'Swing', outcome: 'strikeout', pitchLocation: 'B-Low', pitchZone: 'Ball' }),
      P({ pitchType: 'CB', strikesBefore: 2, action: 'Look', outcome: 'ball', pitchLocation: 'B-Low', pitchZone: 'Ball' }),
    ]);
    expect(r.putAway?.name).toBe('CB');
    expect(r.putAway?.detail).toBe('2 K in 3 two-strike pitches');
    expect(r.putAway?.bestPitch?.detail).toBe('Low (ball)');
  });

  it('Chase Bait needs 3 pitches in a direction; a disciplined hitter is called out', () => {
    expect(analyzeBatter([ball({ action: 'Swing', outcome: 'swinging-strike' })]).chase).toBeNull();
    const eager = analyzeBatter([
      ball({ action: 'Swing', outcome: 'swinging-strike', pitchType: 'SL' }), ball({ action: 'Swing', outcome: 'swinging-strike', pitchType: 'SL' }), ball(),
    ]);
    expect(eager.chase).toMatchObject({ key: 'Low', name: 'Below the zone', detail: 'chased 2 of 3 (67%) · 2 whiffs', bestPitch: { type: 'SL' } });
    const patient = analyzeBatter([ball(), ball(), ball(), ball()]);
    expect(patient.chase?.disciplined).toBe(true);
  });

  it('Danger Zone is where the hits are — fouls are not danger', () => {
    const r = analyzeBatter([
      foul({ pitchLocation: 'Z2' }), foul({ pitchLocation: 'Z2' }), foul({ pitchLocation: 'Z2' }),
      hit('double', { pitchLocation: 'Z7', pitchType: 'CH' }), called({ pitchLocation: 'Z7' }),
    ]);
    expect(r.danger?.key).toBe('Z7');
    expect(r.danger?.bestPitch).toEqual({ type: 'CH', detail: '2B' });
  });
});

describe('1st / 2nd pitch', () => {
  it('counts every at-bat across games (not just at-bat #1, #2 …)', () => {
    const pitches: ScoutPitch[] = [];
    for (const g of ['g1', 'g2', 'g3']) {
      for (const ab of [1, 2]) {
        pitches.push(called({ gameId: g, atBatNumber: ab, pitchNumber: 1 }));
        pitches.push(whiff({ gameId: g, atBatNumber: ab, pitchNumber: 2, strikesBefore: 1 }));
      }
    }
    const r = analyzeBatter(pitches);
    expect(r.first.atBats).toBe(6);
    expect(r.second.atBats).toBe(6);
    expect(r.first.advice).toBe('Usually takes — throw a strike');
    expect(r.first.strikeGetter).toMatchObject({ type: 'FB', zone: 'Middle', detail: '6 of 6 for strikes/outs' });
    expect(r.second.advice).toBe('Swings early and misses — attack him');
  });

  it('warns when he ambushes the first pitch', () => {
    const r = analyzeBatter([
      hit('single', { gameId: 'a' }), hit('double', { gameId: 'b' }), foul({ gameId: 'c' }), ball({ gameId: 'd' }),
    ]);
    expect(r.first.tone).toBe('careful');
    expect(r.first.advice).toMatch(/^Ambushes it \(2 hits\)/);
  });
});

describe('Where he does damage + summary', () => {
  it('hits / balls in play per zone, errors excluded, off-the-plate hits counted', () => {
    const r = analyzeBatter([
      hit('single', { pitchLocation: 'Z5' }), hit('out', { pitchLocation: 'Z5' }), hit('error', { pitchLocation: 'Z5' }),
      hit('double', { pitchLocation: 'B-Low', pitchZone: 'Ball' }),
      P({ action: 'Swing', outcome: 'strikeout' }), ball({ outcome: 'walk' }),
    ]);
    expect(r.damage.zones.Z5).toMatchObject({ hits: 1, bip: 3, bases: 1 });
    expect(r.damage.outOfZone).toEqual({ hits: 1, bip: 1, byDir: { Low: 1 } });
    // 2 hits; at-bats = 2 hits + 1 out + 1 error + 1 K (walk isn't an at-bat)
    expect(r.summary).toMatchObject({ hits: 2, atBats: 5 });
  });
});
