-- Migration additive Lucide Sniper V2 Shadow
CREATE TABLE IF NOT EXISTS shadow_signals (
  id TEXT PRIMARY KEY, symbol TEXT NOT NULL, direction TEXT NOT NULL,
  entry REAL NOT NULL, stop_loss REAL NOT NULL, tp1 REAL NOT NULL, tp2 REAL, tp3 REAL,
  score INTEGER NOT NULL, strategy TEXT, reasoning TEXT,
  outcome TEXT NOT NULL DEFAULT 'open', tp_reached INTEGER NOT NULL DEFAULT 0,
  r_multiple REAL, created_at INTEGER NOT NULL, bucket_hour INTEGER NOT NULL,
  progress_at INTEGER, closed_at INTEGER, telegram_sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_shadow_open ON shadow_signals(outcome,symbol);
CREATE INDEX IF NOT EXISTS idx_shadow_created ON shadow_signals(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_shadow_symbol_hour ON shadow_signals(symbol,bucket_hour);
CREATE TABLE IF NOT EXISTS shadow_runs (
  symbol TEXT NOT NULL, bucket_hour INTEGER NOT NULL, status TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  PRIMARY KEY(symbol,bucket_hour)
);
CREATE INDEX IF NOT EXISTS idx_shadow_runs_created ON shadow_runs(created_at DESC);
\n-- Notification Telegram V2 : colonne ajoutée sans toucher aux données historiques.\n-- Pour une base déjà migrée, exécuter une seule fois :\n-- ALTER TABLE shadow_signals ADD COLUMN telegram_sent_at INTEGER;\n
-- Si shadow_signals existait déjà avant cette version, src/lib/schema.ts ajoute
-- automatiquement telegram_sent_at via une migration ALTER TABLE tolérante.
