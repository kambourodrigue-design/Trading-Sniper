-- Lucide D1 schema
-- Application : wrangler d1 execute lucide-db --file=./schema.sql --remote   (ou copier-coller dans la Console D1)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL,               -- starter | pro | elite
  status TEXT NOT NULL,             -- active | canceled | past_due
  provider TEXT NOT NULL,           -- stripe | cinetpay | manual
  provider_ref TEXT,
  current_period_end INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,             -- ex. XAU/USD
  direction TEXT NOT NULL,          -- BUY | SELL
  entry REAL, stop_loss REAL, tp1 REAL, tp2 REAL, tp3 REAL,
  confidence INTEGER,               -- 0-100
  strategy TEXT,
  rr_ratio TEXT,
  source TEXT NOT NULL,             -- auto | manual
  user_id TEXT REFERENCES users(id),-- NULL = signal public
  status TEXT NOT NULL DEFAULT 'published', -- published | hidden
  timeframe TEXT,
  score INTEGER,                    -- score de confluence du moteur
  reasoning TEXT,                   -- confluences + avis IA
  ai_votes TEXT,                    -- JSON [{provider, decision, confidence}]
  tp_reached INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'open', -- open | sl | tp1 | tp2 | tp3 | expired
  closed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_public ON signals(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_open ON signals(outcome, symbol);

CREATE TABLE IF NOT EXISTS kv_cache (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_state (
  symbol TEXT PRIMARY KEY,
  last_hour INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL,             -- rejected | published | ai_rejected | no_ai | error
  dir TEXT,
  score INTEGER,
  gates TEXT,                       -- JSON [{name, ok, detail}]
  ai TEXT,                          -- JSON {verdicts, errors, consensus}
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_log_symbol_ts ON analysis_log(symbol, ts DESC);

-- Règle « 1 seul trade ouvert par actif » garantie par la base (même en cas d'exécutions simultanées)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_per_symbol ON signals(symbol) WHERE outcome = 'open' AND user_id IS NULL;
