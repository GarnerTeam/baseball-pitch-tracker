/**
 * Our team on top, the opponent underneath: "vs Opponent" when we were the
 * home team, "@ Opponent" when we were away (unknown for older games → "vs").
 */
export function matchupSep(weAreHome?: boolean | null): '@' | 'vs' {
  return weAreHome === false ? '@' : 'vs';
}

/** One-line form, e.g. for confirmations: "Rockets @ Eagles". */
export function matchupText(myTeam: string, opponent: string, weAreHome?: boolean | null): string {
  return `${myTeam || 'My Team'} ${matchupSep(weAreHome)} ${opponent || 'Opponent'}`;
}

export function Matchup({ myTeam, opponent, weAreHome, size = 19, center = false }: {
  myTeam: string; opponent: string; weAreHome?: boolean | null; size?: number; center?: boolean;
}) {
  return (
    <div className={`min-w-0 leading-tight ${center ? 'text-center' : ''}`}>
      <p className="font-semibold text-emerald-300 break-words" style={{ fontSize: size }}>{myTeam || 'My Team'}</p>
      <p className="font-semibold text-blue-300 break-words" style={{ fontSize: size }}>
        <span className="text-slate-500 font-medium mr-1.5">{matchupSep(weAreHome)}</span>{opponent || 'Opponent'}
      </p>
    </div>
  );
}
