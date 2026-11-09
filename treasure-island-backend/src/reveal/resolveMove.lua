-- KEYS: 1 match, 2 placement of the match, 3 reveal of the match, 4 reveal queue,
--       5 settlement queue
-- ARGV: 1 playerId, 2 zoneId, 3 now in ms, 4 next turn deadline in ms, 5 matchId,
--       6 key lifetime in seconds
-- returns {"moved", result} or {"ended", result}, where result is hit_big, hit_small or miss,
--         or one of "not_in_reveal", "not_a_participant", "not_your_turn", "turn_expired",
--         "no_moves_left", "zone_already_opened"
if redis.call("HGET", KEYS[1], "status") ~= "reveal" then
  return "not_in_reveal"
end

local player1 = redis.call("HGET", KEYS[1], "player1")
local player2 = redis.call("HGET", KEYS[1], "player2")
local slot, opponentSlot, nextPlayer
if ARGV[1] == player1 then
  slot, opponentSlot, nextPlayer = "p1", "p2", player2
elseif ARGV[1] == player2 then
  slot, opponentSlot, nextPlayer = "p2", "p1", player1
else
  return "not_a_participant"
end

if redis.call("HGET", KEYS[1], "currentTurn") ~= ARGV[1] then
  return "not_your_turn"
end
if tonumber(ARGV[3]) >= tonumber(redis.call("HGET", KEYS[1], "turnDeadline")) then
  return "turn_expired"
end

local moveNumber
if redis.call("HEXISTS", KEYS[3], slot .. "_move_1_result") == 0 then
  moveNumber = 1
elseif redis.call("HEXISTS", KEYS[3], slot .. "_move_2_result") == 0 then
  moveNumber = 2
else
  return "no_moves_left"
end

if redis.call("HGET", KEYS[3], slot .. "_move_1_zone") == ARGV[2]
  or redis.call("HGET", KEYS[3], slot .. "_move_2_zone") == ARGV[2] then
  return "zone_already_opened"
end

local moveResult = "miss"
if redis.call("HGET", KEYS[2], opponentSlot .. "_big") == ARGV[2] then
  moveResult = "hit_big"
elseif redis.call("HGET", KEYS[2], opponentSlot .. "_small") == ARGV[2] then
  moveResult = "hit_small"
end

redis.call("HSET", KEYS[3],
  slot .. "_move_" .. moveNumber .. "_zone", ARGV[2],
  slot .. "_move_" .. moveNumber .. "_result", moveResult
)
redis.call("EXPIRE", KEYS[3], ARGV[6])

local finished = 0
for _, s in ipairs({"p1", "p2"}) do
  for n = 1, 2 do
    if redis.call("HEXISTS", KEYS[3], s .. "_move_" .. n .. "_result") == 1 then
      finished = finished + 1
    end
  end
end

if finished == 4 then
  redis.call("HSET", KEYS[1], "status", "ended", "updatedAt", ARGV[3])
  redis.call("HDEL", KEYS[1], "currentTurn", "turnDeadline")
  redis.call("HINCRBY", KEYS[1], "stateVersion", 1)
  redis.call("ZREM", KEYS[4], ARGV[5])
  redis.call("ZADD", KEYS[5], ARGV[3], ARGV[5])
  return {"ended", moveResult}
end

redis.call("HSET", KEYS[1],
  "currentTurn", nextPlayer,
  "turnDeadline", ARGV[4],
  "updatedAt", ARGV[3]
)
redis.call("HINCRBY", KEYS[1], "stateVersion", 1)
redis.call("ZADD", KEYS[4], ARGV[4], ARGV[5])
return {"moved", moveResult}
