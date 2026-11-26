// Généré depuis schema.sql (ne pas éditer à la main : relancer `python3 gen_schema.py` ou copier les mêmes instructions).
// Appliqué automatiquement au premier appel : aucune étape manuelle sur la base de données.
export const SCHEMA: string[] = [
  "CREATE TABLE IF NOT EXISTS users ( id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at INTEGER NOT NULL )",
  "CREATE TABLE IF NOT EXISTS sessions ( token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
  "CREATE TABLE IF NOT EXISTS subscriptions ( id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), plan TEXT NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL, provider_ref TEXT, current_period_end INTEGER, created_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id)",
  "CREATE TABLE IF NOT EXISTS signals ( id TEXT PRIMARY KEY, symbol TEXT NOT NULL, direction TEXT NOT NULL, entry REAL, stop_loss REAL, tp1 REAL, tp2 REAL, tp3 REAL, confidence INTEGER, strategy TEXT, rr_ratio TEXT, source TEXT NOT NULL, user_id TEXT REFERENCES users(id), status TEXT NOT NULL DEFAULT 'published', timeframe TEXT, score INTEGER, reasoning TEXT, ai_votes TEXT, tp_reached INTEGER NOT NULL DEFAULT 0, outcome TEXT NOT NULL DEFAULT 'open', closed_at INTEGER, progress_at INTEGER, created_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_signals_public ON signals(user_id, status, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_signals_open ON signals(outcome, symbol)",
  "CREATE TABLE IF NOT EXISTS kv_cache ( k TEXT PRIMARY KEY, v TEXT NOT NULL, expires_at INTEGER NOT NULL )",
  "CREATE TABLE IF NOT EXISTS analysis_state ( symbol TEXT PRIMARY KEY, last_hour INTEGER NOT NULL )",
  "CREATE TABLE IF NOT EXISTS backtest_candles ( symbol TEXT NOT NULL, timeframe TEXT NOT NULL, month TEXT NOT NULL, bars TEXT NOT NULL, count INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(symbol, timeframe, month) )",
  "CREATE TABLE IF NOT EXISTS signal_learning ( signal_id TEXT PRIMARY KEY, symbol TEXT NOT NULL, source TEXT NOT NULL, direction TEXT NOT NULL, strategy TEXT, score INTEGER, confidence INTEGER, entry REAL, stop_loss REAL, tp1 REAL, tp2 REAL, tp3 REAL, setup_json TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT 'open', tp_reached INTEGER NOT NULL DEFAULT 0, r_multiple REAL, created_at INTEGER NOT NULL, closed_at INTEGER )",
  "CREATE INDEX IF NOT EXISTS idx_learning_asset ON signal_learning(symbol, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_learning_strategy ON signal_learning(strategy, outcome)",
  "CREATE TABLE IF NOT EXISTS learning_recommendations ( id TEXT PRIMARY KEY, symbol TEXT NOT NULL, strategy TEXT NOT NULL, recommendation TEXT NOT NULL, evidence_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, decided_at INTEGER, decided_by TEXT, decision_note TEXT )",
  "CREATE INDEX IF NOT EXISTS idx_learning_recommendations_status ON learning_recommendations(status, created_at DESC)",
  "CREATE TABLE IF NOT EXISTS engine_control ( id INTEGER PRIMARY KEY CHECK(id=1), active_engine TEXT NOT NULL DEFAULT 'origin', updated_at INTEGER NOT NULL, updated_by TEXT, reason TEXT )",
  "INSERT OR IGNORE INTO engine_control (id, active_engine, updated_at, reason) VALUES (1, 'origin', 0, 'Moteur historique protégé par défaut')",
  "CREATE TABLE IF NOT EXISTS analysis_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, ts INTEGER NOT NULL, status TEXT NOT NULL, dir TEXT, score INTEGER, gates TEXT, ai TEXT, note TEXT )",
  "CREATE INDEX IF NOT EXISTS idx_log_symbol_ts ON analysis_log(symbol, ts DESC)",
  "CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_per_symbol ON signals(symbol) WHERE outcome = 'open' AND user_id IS NULL",
  "CREATE TABLE IF NOT EXISTS shadow_signals (id TEXT PRIMARY KEY, symbol TEXT NOT NULL, direction TEXT NOT NULL, entry REAL NOT NULL, stop_loss REAL NOT NULL, tp1 REAL NOT NULL, tp2 REAL, tp3 REAL, score INTEGER NOT NULL, strategy TEXT, reasoning TEXT, outcome TEXT NOT NULL DEFAULT 'open', tp_reached INTEGER NOT NULL DEFAULT 0, r_multiple REAL, created_at INTEGER NOT NULL, bucket_hour INTEGER NOT NULL, progress_at INTEGER, closed_at INTEGER)",
  "CREATE INDEX IF NOT EXISTS idx_shadow_open ON shadow_signals(outcome,symbol)",
  "CREATE INDEX IF NOT EXISTS idx_shadow_created ON shadow_signals(created_at DESC)",
  "CREATE UNIQUE INDEX IF NOT EXISTS uniq_shadow_symbol_hour ON shadow_signals(symbol,bucket_hour)",
  "CREATE TABLE IF NOT EXISTS shadow_runs (symbol TEXT NOT NULL, bucket_hour INTEGER NOT NULL, status TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, PRIMARY KEY(symbol,bucket_hour))",
  "CREATE INDEX IF NOT EXISTS idx_shadow_runs_created ON shadow_runs(created_at DESC)"
];

// Colonnes ajoutées au fil des versions : ajoutées si elles manquent (l'erreur « colonne déjà existante » est ignorée).
const COLUMNS: string[] = [
  "ALTER TABLE signals ADD COLUMN status TEXT NOT NULL DEFAULT 'published'",
  "ALTER TABLE signals ADD COLUMN timeframe TEXT",
  "ALTER TABLE signals ADD COLUMN score INTEGER",
  "ALTER TABLE signals ADD COLUMN reasoning TEXT",
  "ALTER TABLE signals ADD COLUMN ai_votes TEXT",
  "ALTER TABLE signals ADD COLUMN tp_reached INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE signals ADD COLUMN outcome TEXT NOT NULL DEFAULT 'open'",
  "ALTER TABLE signals ADD COLUMN closed_at INTEGER",
  "ALTER TABLE signals ADD COLUMN progress_at INTEGER",
];

let ready = false;
async function tolerant(env: Env, stmts: string[]): Promise<string[]> {
  const errs: string[] = [];
  for (const s of stmts) { try { await env.DB.prepare(s).run(); } catch (e) { errs.push(`${s.slice(0, 60)} → ${(e as Error).message}`); } }
  return errs;
}
// Crée les tables manquantes et met à niveau une ancienne base (colonnes manquantes, index) — une seule fois par instance du Worker.
// Chaque instruction est exécutée séparément : une instruction en échec n'empêche pas les autres.
export async function ensureSchema(env: Env): Promise<void> {
  // Ne jamais mémoriser une Promise globale entre requêtes Cloudflare Workers :
  // une requête peut se terminer avant qu'une autre ne récupère/résolve cette Promise.
  // Le booléen ne conserve que l'état terminé de l'initialisation dans cette instance.
  if (ready) return;
  await tolerant(env, SCHEMA);                       // tables (et index quand les colonnes existent déjà)
  await tolerant(env, COLUMNS);                      // colonnes manquantes d'une ancienne base
  const errs = await tolerant(env, SCHEMA);          // 2e passe : index qui dépendaient de ces colonnes
  if (errs.length) console.error("schéma : ", errs.join(" | "));
  ready = true;
}
