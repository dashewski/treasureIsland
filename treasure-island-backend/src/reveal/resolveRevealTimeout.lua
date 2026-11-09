-- KEYS: 1 match, 2 reveal of the match, 3 reveal queue, 4 settlement queue
-- ARGV: 1 matchId, 2 now in ms, 3 next turn deadline in ms, 4 key lifetime in seconds
-- returns "skipped", "ended", "not_expired", "already_processed", "invalid_current_turn"
--         or "no_moves_left"
if redis.call("EXISTS", KEYS[1]) == 0 then
  redis.call("ZREM", KEYS[3], ARGV[1])
  return "already_processed"
end
if redis.call("HGET", KEYS[1], "status") ~= "reveal" then
  redis.call("ZREM", KEYS[3], ARGV[1])
  return "already_processed"
end

local turnDeadline = tonumber(redis.call("HGET", KEYS[1], "turnDeadline"))
if turnDeadline == nil then
  return "invalid_current_turn"
end
if tonumber(ARGV[2]) < turnDeadline then
  return "not_expired"
end

local player1 = redis.call("HGET", KEYS[1], "player1")
local player2 = redis.call("HGET", KEYS[1], "player2")
local currentTurn = redis.call("HGET", KEYS[1], "currentTurn")
local slot, nextPlayer
if currentTurn == player1 then
  slot, nextPlayer = "p1", player2
elseif currentTurn == player2 then
  slot, nextPlayer = "p2", player1
else
  return "invalid_current_turn"
end

local moveNumber
if redis.call("HEXISTS", KEYS[2], slot .. "_move_1_result") == 0 then
  moveNumber = 1
elseif redis.call("HEXISTS", KEYS[2], slot .. "_move_2_result") == 0 then
  moveNumber = 2
else
  return "no_moves_left"
end

redis.call("HSET", KEYS[2],
  slot .. "_move_" .. moveNumber .. "_zone", "skipped",
  slot .. "_move_" .. moveNumber .. "_result", "skipped"
)
redis.call("EXPIRE", KEYS[2], ARGV[4])

local finished = 0
for _, s in ipairs({"p1", "p2"}) do
  for n = 1, 2 do
    if redis.call("HEXISTS", KEYS[2], s .. "_move_" .. n .. "_result") == 1 then
      finished = finished + 1
    end
  end
end

if finished == 4 then
  redis.call("HSET", KEYS[1], "status", "ended", "updatedAt", ARGV[2])
  redis.call("HDEL", KEYS[1], "currentTurn", "turnDeadline")
  redis.call("HINCRBY", KEYS[1], "stateVersion", 1)
  redis.call("ZREM", KEYS[3], ARGV[1])
  redis.call("ZADD", KEYS[4], ARGV[2], ARGV[1])
  return "ended"
end

redis.call("HSET", KEYS[1],
  "currentTurn", nextPlayer,
  "turnDeadline", ARGV[3],
  "updatedAt", ARGV[2]
)
redis.call("HINCRBY", KEYS[1], "stateVersion", 1)
redis.call("ZADD", KEYS[3], ARGV[3], ARGV[1])
return "skipped"
