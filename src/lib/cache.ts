// Cache applicatif dans D1 (évite de consommer les 1 000 écritures/jour de KV).
export async function cacheGet(env: Env, k: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT v FROM kv_cache WHERE k = ? AND expires_at > ?").bind(k, Math.floor(Date.now() / 1000)).first<{ v: string }>();
  return r?.v ?? null;
}
export async function cacheSet(env: Env, k: string, v: string, ttlSec: number): Promise<void> {
  await env.DB.prepare("INSERT INTO kv_cache (k, v, expires_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, expires_at = excluded.expires_at")
    .bind(k, v, Math.floor(Date.now() / 1000) + ttlSec).run();
}
export async function cachePurge(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM kv_cache WHERE expires_at < ?").bind(Math.floor(Date.now() / 1000)).run();
}
