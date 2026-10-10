import { describe, it, expect } from 'vitest';
import { clusterBatters, parseName, type BatterRecord } from '@/lib/player-match';

const rec = (name: string, number: string, team: string, pitchCount = 5): BatterRecord =>
  ({ key: `${name}|${number}|${team}`, name, number, team, pitchCount });

describe('parseName', () => {
  it('reads the ways coaches type names', () => {
    expect(parseName('Petronio')).toEqual({ first: '', last: 'petronio' });
    expect(parseName('C Brauer')).toEqual({ first: 'c', last: 'brauer' });
    expect(parseName('Bryce G')).toEqual({ first: 'bryce', last: 'g' });
    expect(parseName('Vinny  Frick')).toEqual({ first: 'vinny', last: 'frick' });
  });
});

describe('clusterBatters', () => {
  it('same name and number on two teams is one player (kids play on more than one team)', () => {
    const { clusters } = clusterBatters([rec('Smith', '11', 'Hawks'), rec('Smith', '11', 'Tigers')]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ teams: ['Hawks', 'Tigers'], crossTeam: true });
  });

  it('a record with no number joins the numbered player only on the same team', () => {
    const { clusters } = clusterBatters([
      rec('Blumstein', '2', 'Hawks', 20), rec('Blumstein', '', 'Hawks', 8), rec('Blumstein', '', 'Tigers', 3),
    ]);
    expect(clusters.map(c => [c.number, c.members.length, c.teams])).toEqual([['2', 2, ['Hawks']], ['', 1, ['Tigers']]]);
    expect(clusters[0].fillsMissingNumber).toBe(true);
  });

  it('different numbers stay different players', () => {
    expect(clusterBatters([rec('Koenig', '65', 'A'), rec('Koenig', '66', 'A')]).clusters).toHaveLength(2);
  });

  it('first names must not conflict; initials and missing first names are fine', () => {
    const { clusters } = clusterBatters([rec('J Smith', '7', 'A'), rec('Jake Smith', '7', 'A'), rec('Smith', '7', 'B'), rec('Tom Smith', '7', 'A')]);
    expect(clusters.map(c => c.members.map(m => m.name).sort())).toEqual([['J Smith', 'Jake Smith', 'Smith'], ['Tom Smith']]);
    expect(clusters[0].name).toBe('Jake Smith');
  });

  it('joins existing players first and skips placeholders', () => {
    const { clusters, skipped } = clusterBatters(
      [rec('Schmidt', '42', 'A'), rec('U', '', 'A'), rec('Newkid', '9', 'A')],
      [{ id: 'PLR0005', name: 'Schmidt', number: '42', teams: ['A'] }],
    );
    expect(clusters.map(c => c.playerId || c.name)).toEqual(['PLR0005', 'Newkid']);
    expect(skipped.map(s => s.name)).toEqual(['U']);
  });
});
