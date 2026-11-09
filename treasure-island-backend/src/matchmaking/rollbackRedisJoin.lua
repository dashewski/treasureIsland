-- KEYS: 1 match, 2 placement of the match, 3 waiting queue, 4 placement queue
-- ARGV: 1 player2Id, 2 matchId, 3 now
-- returns "ok" when the match is waiting again, "not_rollbackable" when it must not be touched
if redis.call("HGET", KEYS[1], "status") ~= "placement"
  or redis.call("HGET", KEYS[1], "player2") ~= ARGV[1]
  or redis.call("EXISTS", KEYS[2]) == 1 then
  return "not_rollbackable"
end

local createdAt = redis.call("HGET", KEYS[1], "createdAt")

redis.call("HSET", KEYS[1], "status", "waiting", "updatedAt", ARGV[3])
redis.call("HDEL", KEYS[1], "player2", "player2HoldId", "placementDeadline")
redis.call("HINCRBY", KEYS[1], "stateVersion", 1)
redis.call("ZREM", KEYS[4], ARGV[2])
redis.call("DEL", "player:" .. ARGV[1] .. ":currentMatch")
redis.call("ZADD", KEYS[3], createdAt, ARGV[2])
return "ok"
