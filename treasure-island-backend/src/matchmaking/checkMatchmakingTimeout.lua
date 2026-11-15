-- KEYS: 1 match, 2 waiting queue
-- ARGV: 1 matchId, 2 now in ms, 3 waiting time in ms, 4 lifetime of a finished match in seconds
-- returns "already processed", "still waiting" or {"cancelled", player1HoldId}
if redis.call("EXISTS", KEYS[1]) == 0 then
  redis.call("ZREM", KEYS[2], ARGV[1])
  return "already processed"
end
if redis.call("HGET", KEYS[1], "status") ~= "waiting" then
  redis.call("ZREM", KEYS[2], ARGV[1])
  return "already processed"
end
local createdAt = tonumber(redis.call("HGET", KEYS[1], "createdAt"))
if tonumber(ARGV[2]) - createdAt < tonumber(ARGV[3]) then
  return "still waiting"
end

local player1 = redis.call("HGET", KEYS[1], "player1")
local hold1 = redis.call("HGET", KEYS[1], "player1HoldId")

redis.call("HSET", KEYS[1],
  "status", "cancelled",
  "cancelReason", "matchmaking_timeout",
  "updatedAt", ARGV[2]
)
redis.call("HINCRBY", KEYS[1], "stateVersion", 1)
redis.call("ZREM", KEYS[2], ARGV[1])
redis.call("DEL", "player:" .. player1 .. ":currentMatch")
redis.call("EXPIRE", KEYS[1], ARGV[4])
return {"cancelled", hold1}
