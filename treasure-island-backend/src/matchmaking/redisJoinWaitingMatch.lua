-- KEYS: 1 match, 2 trylock of the match, 3 waiting queue, 4 placement queue
-- ARGV: 1 holdId, 2 lock token, 3 playerId, 4 matchId, 5 now,
--       6 placement deadline in ms, 7 key lifetime in seconds
-- returns matchId, or nil if the match cannot be joined
if redis.call("GET", KEYS[2]) ~= ARGV[2] then
  return nil
end
if redis.call("EXISTS", KEYS[1]) == 0 then
  return nil
end
if redis.call("HGET", KEYS[1], "status") ~= "waiting" then
  return nil
end
if redis.call("HGET", KEYS[1], "player2") ~= false then
  return nil
end
if redis.call("HGET", KEYS[1], "player1") == ARGV[3] then
  return nil
end

redis.call("HSET", KEYS[1],
  "status", "placement",
  "player2", ARGV[3],
  "player2HoldId", ARGV[1],
  "updatedAt", ARGV[5],
  "placementDeadline", ARGV[6]
)
redis.call("HINCRBY", KEYS[1], "stateVersion", 1)
redis.call("EXPIRE", KEYS[1], ARGV[7])
redis.call("ZADD", KEYS[4], ARGV[6], ARGV[4])
redis.call("ZREM", KEYS[3], ARGV[4])

local player1 = redis.call("HGET", KEYS[1], "player1")
redis.call("SET", "player:" .. player1 .. ":currentMatch", ARGV[4], "EX", ARGV[7])
redis.call("SET", "player:" .. ARGV[3] .. ":currentMatch", ARGV[4], "EX", ARGV[7])
redis.call("DEL", KEYS[2])
return ARGV[4]
