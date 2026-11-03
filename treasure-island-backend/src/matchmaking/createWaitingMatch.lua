-- KEYS: 1 lock:create, 2 match, 3 waiting queue, 4 pointer of the player
-- ARGV: 1 lock token, 2 matchId, 3 playerId, 4 holdId, 5 bid, 6 bigAmount,
--       7 smallAmount, 8 now, 9 key lifetime in seconds
-- returns matchId, or nil if the lock token is not the current one
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
  return nil
end

redis.call("HSET", KEYS[2],
  "matchId", ARGV[2],
  "status", "waiting",
  "player1", ARGV[3],
  "player1HoldId", ARGV[4],
  "bid", ARGV[5],
  "bigAmount", ARGV[6],
  "smallAmount", ARGV[7],
  "createdAt", ARGV[8],
  "updatedAt", ARGV[8],
  "stateVersion", "0"
)
redis.call("EXPIRE", KEYS[2], ARGV[9])
redis.call("ZADD", KEYS[3], ARGV[8], ARGV[2])
redis.call("SET", KEYS[4], ARGV[2], "EX", ARGV[9])
redis.call("DEL", KEYS[1])
return ARGV[2]
