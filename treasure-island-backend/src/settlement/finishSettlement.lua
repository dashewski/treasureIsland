-- KEYS: 1 match, 2 placement, 3 reveal, 4 reveal queue, 5 settlement queue,
--       6 pointer of player 1, 7 pointer of player 2
-- ARGV: 1 matchId, 2 lifetime of a finished match in seconds
-- Runs after the money is settled. A pointer is deleted only if it still leads to this
-- match: the player may already have started a new one.
for i = 6, 7 do
  if redis.call("GET", KEYS[i]) == ARGV[1] then
    redis.call("DEL", KEYS[i])
  end
end
redis.call("ZREM", KEYS[4], ARGV[1])
redis.call("ZREM", KEYS[5], ARGV[1])
for i = 1, 3 do
  redis.call("EXPIRE", KEYS[i], ARGV[2])
end
return 1
