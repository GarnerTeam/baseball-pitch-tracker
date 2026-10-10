-- Baseball Pitch Tracker — initial Postgres schema.
--
-- Mirrors the three Google Sheets tabs (Pitches, Players, Rosters) closely
-- enough that every existing API response can be served from either store
-- with identical shapes. Scoping rule (same as the Apps Script
-- rowMatchesScope): a row belongs to `org_id` when it has one; legacy rows
-- written before organizations existed have org_id = '' and belong to the
-- `user_id` that recorded them.

CREATE TABLE pitches (
  id               text PRIMARY KEY,           -- client pitch id ("pitch-…"), or "sheet-<hash>" for imported rows that had none
  org_id           text NOT NULL DEFAULT '',
  user_id          text NOT NULL DEFAULT '',
  game_id          text NOT NULL,
  ts               timestamptz,
  home_team        text NOT NULL DEFAULT '',
  visiting_team    text NOT NULL DEFAULT '',
  pitcher_number   text NOT NULL DEFAULT '',
  pitcher_name     text NOT NULL DEFAULT '',
  batter_number    text NOT NULL DEFAULT '',
  batter_name      text NOT NULL DEFAULT '',
  batter_hand      text NOT NULL DEFAULT '',
  lineup_position  integer,                    -- 1-based, as written to the sheet
  at_bat_number    integer,
  pitch_number     integer,
  balls_before     integer,
  strikes_before   integer,
  pitch_type       text NOT NULL DEFAULT '',
  pitch_zone       text NOT NULL DEFAULT '',
  pitch_location   text NOT NULL DEFAULT '',
  action           text NOT NULL DEFAULT '',
  outcome          text NOT NULL DEFAULT '',
  balls_after      integer,
  strikes_after    integer,
  hit_type         text NOT NULL DEFAULT '',
  hit_type_name    text NOT NULL DEFAULT '',
  hit_result       text NOT NULL DEFAULT '',
  hit_result_name  text NOT NULL DEFAULT '',
  hit_zone         text NOT NULL DEFAULT '',
  hit_x            double precision,
  hit_y            double precision,
  runner_1b        text NOT NULL DEFAULT '',
  runner_2b        text NOT NULL DEFAULT '',
  runner_3b        text NOT NULL DEFAULT '',
  outs_count       integer,
  base_state       text NOT NULL DEFAULT '',
  roster_player_id text NOT NULL DEFAULT '',
  player_id        text NOT NULL DEFAULT '',
  source           text NOT NULL DEFAULT 'app',  -- 'app' | 'sheet_import'
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pitches_org_game_idx    ON pitches (org_id, game_id);
CREATE INDEX pitches_user_game_idx   ON pitches (user_id, game_id) WHERE org_id = '';
CREATE INDEX pitches_org_player_idx  ON pitches (org_id, player_id) WHERE player_id <> '';
CREATE INDEX pitches_org_roster_idx  ON pitches (org_id, roster_player_id) WHERE roster_player_id <> '';
CREATE INDEX pitches_org_batter_idx  ON pitches (org_id, lower(batter_name));
CREATE INDEX pitches_player_idx      ON pitches (player_id) WHERE player_id <> '';

CREATE TABLE players (
  id          text PRIMARY KEY,                -- "PLR0001"
  org_id      text NOT NULL DEFAULT '',
  created_by  text NOT NULL DEFAULT '',         -- audit + legacy scope fallback
  name        text NOT NULL,
  number      text NOT NULL DEFAULT '',
  hand        text NOT NULL DEFAULT '',
  first_seen  timestamptz,
  last_seen   timestamptz,
  notes       text NOT NULL DEFAULT '',
  verified    boolean NOT NULL DEFAULT true,
  is_active   boolean NOT NULL DEFAULT true,
  merged_into text,                             -- set when deactivated by a merge
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX players_org_idx ON players (org_id);

-- New player ids continue the sheet's "PLR####" sequence. The import sets
-- this past the highest imported id (see lib/db/store.ts).
CREATE SEQUENCE player_id_seq START 1;

CREATE TABLE rosters (
  seq        bigserial,                         -- keeps the order players were first saved (the Sheet's row order)
  org_id     text NOT NULL DEFAULT '',
  user_id    text NOT NULL DEFAULT '',
  scope_key  text GENERATED ALWAYS AS (CASE WHEN org_id <> '' THEN org_id ELSE user_id END) STORED,
  team_name  text NOT NULL,
  player_id  text NOT NULL,                     -- "roster-<uuid>" (or a PLR id after a merge)
  name       text NOT NULL DEFAULT '',
  number     text NOT NULL DEFAULT '',
  hand       text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, player_id)
);

CREATE INDEX rosters_scope_team_idx ON rosters (scope_key, lower(team_name));
