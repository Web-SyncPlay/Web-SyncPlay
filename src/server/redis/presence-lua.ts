/**
 * Valkey/Redis Lua scripts for presence HASH operations.
 * Kept separate from RoomStateStore so script text can be reviewed/versioned
 * without scrolling past WATCH/room JSON logic.
 */

/**
 * Atomic node-map presence bump: HGET → decode → adjust nodeId → HSET/HDEL + EXPIRE.
 * Legacy plain-integer fields are treated as empty (orphaned) maps.
 * KEYS[1]=hash  ARGV[1]=userId  ARGV[2]=nodeId  ARGV[3]=delta  ARGV[4]=ttlSeconds
 * Returns remaining total refcount for the user (0 if field removed).
 */
export const PRESENCE_BUMP_SCRIPT = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
local counts = {}
if raw and raw ~= '' then
  local asInt = tonumber(raw)
  if not (asInt and tostring(asInt) == raw) then
    local ok, parsed = pcall(cjson.decode, raw)
    if ok and type(parsed) == 'table' then
      counts = parsed
    end
  end
end

local nodeId = ARGV[2]
local delta = tonumber(ARGV[3]) or 0
local n = (tonumber(counts[nodeId]) or 0) + delta
if n <= 0 then
  counts[nodeId] = nil
else
  counts[nodeId] = math.floor(n)
end

local cleaned = {}
local remaining = 0
for k, v in pairs(counts) do
  local vn = tonumber(v)
  if vn and vn > 0 and type(k) == 'string' and #k > 0 then
    cleaned[k] = math.floor(vn)
    remaining = remaining + vn
  end
end

if remaining <= 0 then
  redis.call('HDEL', KEYS[1], ARGV[1])
else
  redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(cleaned))
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return remaining
`

/**
 * Atomic presence-data merge: HGET → shallow merge → HSET + EXPIRE.
 * Concurrent patches cannot clobber unrelated fields.
 * `localPlayback` / `localPlaybackReports` keep existing when the patch omits
 * them or sends JSON null (matches JS `??` semantics; not a deep key merge).
 * KEYS[1]=hash  ARGV[1]=userId  ARGV[2]=patchJson  ARGV[3]=ttlSeconds
 * Returns 1 on success.
 */
export const PRESENCE_MERGE_SCRIPT = `
pcall(function()
  cjson.encode_empty_table_as_object(true)
end)

local raw = redis.call('HGET', KEYS[1], ARGV[1])
local existing = {}
if raw and raw ~= '' then
  local ok, parsed = pcall(cjson.decode, raw)
  if ok and type(parsed) == 'table' then
    existing = parsed
  end
end

local okPatch, patch = pcall(cjson.decode, ARGV[2])
if not okPatch or type(patch) ~= 'table' then
  return redis.error_reply('mergePresenceData: invalid patch JSON')
end

local merged = {}
for k, v in pairs(existing) do
  merged[k] = v
end
for k, v in pairs(patch) do
  merged[k] = v
end

local function is_nullish(v)
  return v == nil or v == cjson.null
end

if is_nullish(patch['localPlayback']) then
  merged['localPlayback'] = existing['localPlayback']
else
  merged['localPlayback'] = patch['localPlayback']
end

if is_nullish(patch['localPlaybackReports']) then
  merged['localPlaybackReports'] = existing['localPlaybackReports']
else
  merged['localPlaybackReports'] = patch['localPlaybackReports']
end

if is_nullish(merged['localPlayback']) then
  merged['localPlayback'] = nil
end
if is_nullish(merged['localPlaybackReports']) then
  merged['localPlaybackReports'] = nil
end

redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(merged))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`
