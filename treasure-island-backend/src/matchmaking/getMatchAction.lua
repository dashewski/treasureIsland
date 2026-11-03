
local candidates = redis.call("ZRANGE", KEYS[1], 0, 9)

for _, matchId in ipairs(candidates) do
  if redis.call("EXISTS", "match:" .. matchId) == 0 then
    redis.call("ZREM", KEYS[1], matchId)
  elseif redis.call("SET", "match:" .. matchId .. ":trylock", ARGV[1], "NX", "PX", ARGV[2]) then
    return {"join", matchId, ARGV[1]}
  end
end

if redis.call("SET", KEYS[2], ARGV[1], "NX", "PX", ARGV[3]) then
  return {"create", ARGV[1]}
end

return nil
