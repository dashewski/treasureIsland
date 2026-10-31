-- Tables only, indexes are in indexes.sql. Apply to an empty database:
--   psql -v ON_ERROR_STOP=1 -d <database> -f db/schema.sql

CREATE TABLE players (
  id SERIAL PRIMARY KEY,
  tgid BIGINT UNIQUE NOT NULL,
  player VARCHAR(255),
  balance NUMERIC(12, 2) DEFAULT 0,
  matches INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "lastPlays" TIMESTAMP
);

-- free balance = players.balance minus the sum of active holds
CREATE TABLE balance_holds (
  id SERIAL PRIMARY KEY,
  "playerId" INTEGER REFERENCES players(id),
  type VARCHAR(20) NOT NULL,                     -- match_bid | withdrawal
  amount NUMERIC(12, 2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | released | consumed
  "refId" VARCHAR(50),                           -- match id or withdrawal id, NULL until linked
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "expiresAt" TIMESTAMP
);

CREATE TABLE withdrawals (
  id SERIAL PRIMARY KEY,
  "playerId" INTEGER REFERENCES players(id),
  amount NUMERIC(12, 2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | completed | cancelled
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "processedAt" TIMESTAMP
);

CREATE TABLE match_history (
  id SERIAL PRIMARY KEY,
  "matchId" VARCHAR(50) UNIQUE NOT NULL,
  "player1Id" INTEGER REFERENCES players(id),
  "player2Id" INTEGER REFERENCES players(id),
  bid NUMERIC(12, 2),
  result VARCHAR(20) NOT NULL,                    -- played | cancelled
  "p1Winnings" NUMERIC(12, 2),                    -- payout after the fee
  "p2Winnings" NUMERIC(12, 2),
  fee NUMERIC(12, 2),
  "cancelReason" VARCHAR(100),
  moves JSONB,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "finishedAt" TIMESTAMP
);
