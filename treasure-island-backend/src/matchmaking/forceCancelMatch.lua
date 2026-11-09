-- KEYS: 1 match, 2 placement of the match, 3 waiting queue, 4 placement queue
-- ARGV: 1 player2Id, 2 matchId, 3 now, 4 lifetime of a finished match in seconds
-- returns 1 when the match exists (cancelled now or already finished), 0 when there is no match
if redis.call("EXISTS", KEYS[1]) == 0 then
  return 0
end

local status = redis.call("HGET", KEYS[1], "status")
if status == "ended" or status == "cancelled" then
  return 1
end

local player1 = redis.call("HGET", KEYS[1], "player1")

redis.call("HSET", KEYS[1],
  "status", "cancelled",
  "cancelReason", "internal_error",
  "updatedAt", ARGV[3]
)
redis.call("HINCRBY", KEYS[1], "stateVersion", 1)
redis.call("EXPIRE", KEYS[1], ARGV[4])
redis.call("DEL", KEYS[2])
redis.call("ZREM", KEYS[3], ARGV[2])
redis.call("ZREM", KEYS[4], ARGV[2])
redis.call("DEL", "player:" .. player1 .. ":currentMatch")
redis.call("DEL", "player:" .. ARGV[1] .. ":currentMatch")
return 1
