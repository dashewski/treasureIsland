-- KEYS: 1 match, 2 placement of the match, 3 placement queue, 4 reveal queue
-- ARGV: 1 playerSlot, 2 chestType, 3 zoneId, 4 now in ms, 5 first turn deadline in ms,
--       6 matchId, 7 key lifetime in seconds
-- returns "placed", "completed", "already_placed", "zone_already_used",
--         "not_in_placement" or "placement_timeout"

local field = ARGV[1] .. "_" .. ARGV[2] -- p1_big, p1_small, p2_big, p2_small
local otherType = ""                    -- empty variable


if redis.call("HGET", KEYS[1], "status") ~= "placement" then
    return "not_in_placement"
end
if tonumber(redis.call("HGET", KEYS[1], "placementDeadline")) < tonumber(ARGV[4]) then
    return "placement_timeout"
end

if ARGV[2] == "big" then otherType = "small" else otherType = "big" end

local otherField = ARGV[1] .. "_" .. otherType

if redis.call("HGET", KEYS[2], otherField) == ARGV[3] then
    return "zone_already_used"
end


if redis.call("HSETNX", KEYS[2], field, ARGV[3]) == 0 then
  return "already_placed"
end
redis.call("EXPIRE", KEYS[2], ARGV[7])

if redis.call("HLEN", KEYS[2]) < 4 then
  redis.call("HSET", KEYS[1], "updatedAt", ARGV[4])
  redis.call("HINCRBY", KEYS[1], "stateVersion", 1)
  return "placed"
end

redis.call("ZREM", KEYS[3], ARGV[6])
redis.call("HSET", KEYS[1],
  "status", "reveal",
  "currentTurn", redis.call("HGET", KEYS[1], "player1"),
  "turnDeadline", ARGV[5],
  "updatedAt", ARGV[4]
)
redis.call("ZADD", KEYS[4], ARGV[5], ARGV[6])
redis.call("HINCRBY", KEYS[1], "stateVersion", 1)
return "completed"
