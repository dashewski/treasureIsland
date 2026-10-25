// Durations are in seconds. Redis and Lua store milliseconds, so multiply by 1000.

export const MATCH_STAKE = 5;
export const MAX_MATCH_ATTEMPTS = 5;
export const MATCHMAKING_TIMEOUT = 90;
export const HOLD_SAFETY_TIMEOUT = 120;
export const PLACEMENT_TIMEOUT = 45;
export const TURN_TIMEOUT = 30;
export const FEE_PERCENT = 10;
export const MATCH_KEY_TTL = 3600;
export const FINISHED_KEY_TTL = 600;
export const WORKER_FAST_INTERVAL = 1;
export const WORKER_SLOW_INTERVAL = 10;
export const SETTLEMENT_MAX_FAILS = 10;
export const POLL_INTERVAL = 2;
export const JWT_TTL = 600;
export const INITDATA_MAX_AGE = 86400;

export const ZONE_COUNT = 5;
