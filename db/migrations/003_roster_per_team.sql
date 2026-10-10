-- A player can be on more than one team's Saved Roster (kids play for
-- several teams). Rosters were unique per (scope, player); now they are
-- unique per (scope, team, player), with team names compared the same way
-- Load Roster compares them (case and surrounding spaces ignored).

ALTER TABLE rosters DROP CONSTRAINT rosters_pkey;

CREATE UNIQUE INDEX rosters_scope_team_player_idx ON rosters (scope_key, lower(btrim(team_name)), player_id);
