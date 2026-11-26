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
  progress_at INTEGER,               -- ms : début de la bougie du dernier palier (TP1/TP2) atteint
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

-- Historique backtest importé par l’administrateur (stockage D1 sans R2)
CREATE TABLE IF NOT EXISTS backtest_candles ( symbol TEXT NOT NULL, timeframe TEXT NOT NULL, month TEXT NOT NULL, bars TEXT NOT NULL, count INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(symbol, timeframe, month) );

-- Apprentissage V1 : instantané des setups et résultats, sans effet sur les signaux.
CREATE TABLE IF NOT EXISTS signal_learning (
  signal_id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  source TEXT NOT NULL,
  direction TEXT NOT NULL,
  strategy TEXT,
  score INTEGER,
  confidence INTEGER,
  entry REAL, stop_loss REAL, tp1 REAL, tp2 REAL, tp3 REAL,
  setup_json TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'open',
  tp_reached INTEGER NOT NULL DEFAULT 0,
  r_multiple REAL,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_learning_asset ON signal_learning(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_strategy ON signal_learning(strategy, outcome);

-- Apprentissage V2 : recommandations soumises à validation humaine.
CREATE TABLE IF NOT EXISTS learning_recommendations (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  strategy TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT,
  decision_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_learning_recommendations_status
  ON learning_recommendations(status, created_at DESC);

-- Gouvernance moteur : le moteur historique reste actif par défaut.
CREATE TABLE IF NOT EXISTS engine_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  active_engine TEXT NOT NULL DEFAULT 'origin',
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  reason TEXT
);
INSERT OR IGNORE INTO engine_control (id, active_engine, updated_at, reason)
VALUES (1, 'origin', 0, 'Moteur historique protégé par défaut');


-- V2 indépendante en shadow : données virtuelles séparées, sans impact sur signals.
CREATE TABLE IF NOT EXISTS shadow_signals (
  id TEXT PRIMARY KEY, symbol TEXT NOT NULL, direction TEXT NOT NULL,
  entry REAL NOT NULL, stop_loss REAL NOT NULL, tp1 REAL NOT NULL, tp2 REAL, tp3 REAL,
  score INTEGER NOT NULL, strategy TEXT, reasoning TEXT,
  outcome TEXT NOT NULL DEFAULT 'open', tp_reached INTEGER NOT NULL DEFAULT 0,
  r_multiple REAL, created_at INTEGER NOT NULL, bucket_hour INTEGER NOT NULL,
  progress_at INTEGER, closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_shadow_open ON shadow_signals(outcome,symbol);
CREATE INDEX IF NOT EXISTS idx_shadow_created ON shadow_signals(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_shadow_symbol_hour ON shadow_signals(symbol,bucket_hour);

CREATE TABLE IF NOT EXISTS shadow_runs (
  symbol TEXT NOT NULL,
  bucket_hour INTEGER NOT NULL,
  status TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(symbol,bucket_hour)
);
CREATE INDEX IF NOT EXISTS idx_shadow_runs_created ON shadow_runs(created_at DESC);
