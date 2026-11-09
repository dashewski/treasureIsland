-- KEYS: 1 match, 2 placement of the match, 3 placement queue
-- ARGV: 1 matchId, 2 now in ms, 3 lifetime of a finished match in seconds
-- returns "already processed", "still placement", "invalid_state",
--         or {"cancelled", player1HoldId, player2HoldId}
if redis.call("EXISTS", KEYS[1]) == 0 then
  redis.call("ZREM", KEYS[3], ARGV[1])
  return "already processed"
end
if redis.call("HGET", KEYS[1], "status") ~= "placement" then
  redis.call("ZREM", KEYS[3], ARGV[1])
  return "already processed"
end
if tonumber(ARGV[2]) <= tonumber(redis.call("HGET", KEYS[1], "placementDeadline")) then
  return "still placement"
end
if redis.call("HLEN", KEYS[2]) == 4 then
  return "invalid_state"
end

local player1 = redis.call("HGET", KEYS[1], "player1")
local player2 = redis.call("HGET", KEYS[1], "player2")
local hold1 = redis.call("HGET", KEYS[1], "player1HoldId")
local hold2 = redis.call("HGET", KEYS[1], "player2HoldId")

redis.call("HSET", KEYS[1],
  "status", "cancelled",
  "cancelReason", "placement_timeout",
  "updatedAt", ARGV[2]
)
redis.call("HINCRBY", KEYS[1], "stateVersion", 1)
redis.call("ZREM", KEYS[3], ARGV[1])
redis.call("DEL", "player:" .. player1 .. ":currentMatch")
redis.call("DEL", "player:" .. player2 .. ":currentMatch")
redis.call("EXPIRE", KEYS[1], ARGV[3])
redis.call("EXPIRE", KEYS[2], ARGV[3])
return {"cancelled", hold1, hold2}
