-- To write: run after schema.sql.
--   psql -v ON_ERROR_STOP=1 -d <database> -f db/indexes.sql
--
-- balance_holds
--   idx_holds_player_active              active holds of one player (free balance)
--   idx_holds_expired                    active holds sorted by expiresAt (checkExpiredHolds)
--   unique_active_match_hold_per_player  one active match_bid per player at most
-- match_history
--   idx_history_player1, idx_history_player2   last match of a player (player id, finishedAt)


create INDEX idx_holds_player_active on balance_holds("playerId") WHERE status='active';

create INDEX idx_holds_expired on balance_holds("expiresAt") WHERE status='active';

create UNIQUE INDEX unique_active_match_hold_per_player on balance_holds("playerId") WHERE status = 'active' AND type = 'match_bid';

create INDEX idx_history_player1 on match_history("player1Id", "finishedAt" DESC) WHERE result='played';

create INDEX idx_history_player2 on match_history("player2Id", "finishedAt" DESC) WHERE result='played';
