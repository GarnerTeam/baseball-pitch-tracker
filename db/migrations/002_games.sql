-- Saved games: the full live game (lineup, pitcher, count, outs, bases,
-- every at-bat) as the app last saw it, so a game can be resumed on any
-- device, and an explicit status so "End Game" means something.
--
-- The pitches table stays the record of what happened; `snapshot` is only
-- the app's working state and is replaced on every save.

CREATE TABLE games (
  org_id        text NOT NULL,                 -- organization, or the user id for a personal account
  game_id       text NOT NULL,
  user_id       text NOT NULL DEFAULT '',      -- who saved it last
  home_team     text NOT NULL DEFAULT '',
  visiting_team text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'active', -- 'active' | 'final'
  pitch_count   integer NOT NULL DEFAULT 0,
  snapshot      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  PRIMARY KEY (org_id, game_id)
);

CREATE INDEX games_org_status_idx ON games (org_id, status, updated_at DESC);
