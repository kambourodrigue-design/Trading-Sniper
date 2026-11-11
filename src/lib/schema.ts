// Généré depuis schema.sql (ne pas éditer à la main : relancer `python3 gen_schema.py` ou copier les mêmes instructions).
// Appliqué automatiquement au premier appel : aucune étape manuelle sur la base de données.
export const SCHEMA: string[] = [
  "CREATE TABLE IF NOT EXISTS users ( id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at INTEGER NOT NULL )",
  "CREATE TABLE IF NOT EXISTS sessions ( token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
  "CREATE TABLE IF NOT EXISTS subscriptions ( id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), plan TEXT NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL, provider_ref TEXT, current_period_end INTEGER, created_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id)",
  "CREATE TABLE IF NOT EXISTS signals ( id TEXT PRIMARY KEY, symbol TEXT NOT NULL, direction TEXT NOT NULL, entry REAL, stop_loss REAL, tp1 REAL, tp2 REAL, tp3 REAL, confidence INTEGER, strategy TEXT, rr_ratio TEXT, source TEXT NOT NULL, user_id TEXT REFERENCES users(id), status TEXT NOT NULL DEFAULT 'published', timeframe TEXT, score INTEGER, reasoning TEXT, ai_votes TEXT, tp_reached INTEGER NOT NULL DEFAULT 0, outcome TEXT NOT NULL DEFAULT 'open', closed_at INTEGER, created_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_signals_public ON signals(user_id, status, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_signals_open ON signals(outcome, symbol)",
  "CREATE TABLE IF NOT EXISTS kv_cache ( k TEXT PRIMARY KEY, v TEXT NOT NULL, expires_at INTEGER NOT NULL )",
  "CREATE TABLE IF NOT EXISTS analysis_state ( symbol TEXT PRIMARY KEY, last_hour INTEGER NOT NULL )",
  "CREATE TABLE IF NOT EXISTS analysis_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, ts INTEGER NOT NULL, status TEXT NOT NULL, dir TEXT, score INTEGER, gates TEXT, ai TEXT, note TEXT )",
  "CREATE INDEX IF NOT EXISTS idx_log_symbol_ts ON analysis_log(symbol, ts DESC)",
  "CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_per_symbol ON signals(symbol) WHERE outcome = 'open' AND user_id IS NULL"
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
];

let ready: Promise<void> | null = null;
async function tolerant(env: Env, stmts: string[]): Promise<string[]> {
  const errs: string[] = [];
  for (const s of stmts) { try { await env.DB.prepare(s).run(); } catch (e) { errs.push(`${s.slice(0, 60)} → ${(e as Error).message}`); } }
  return errs;
}
// Crée les tables manquantes et met à niveau une ancienne base (colonnes manquantes, index) — une seule fois par instance du Worker.
// Chaque instruction est exécutée séparément : une instruction en échec n'empêche pas les autres.
export function ensureSchema(env: Env): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await tolerant(env, SCHEMA);                       // tables (et index quand les colonnes existent déjà)
      await tolerant(env, COLUMNS);                      // colonnes manquantes d'une ancienne base
      const errs = await tolerant(env, SCHEMA);          // 2e passe : index qui dépendaient de ces colonnes
      if (errs.length) console.error("schéma : ", errs.join(" | "));
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}
