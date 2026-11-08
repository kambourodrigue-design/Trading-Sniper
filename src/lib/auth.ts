// Password hashing via Web Crypto PBKDF2 — no native bindings needed,
// works as-is in the Workers runtime.

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBuf(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  return arr;
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return { hash: bufToHex(hash), salt: bufToHex(salt.buffer as ArrayBuffer) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const computed = await pbkdf2(password, hexToBuf(salt));
  return bufToHex(computed) === hash;
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256
  );
}

export function newId(): string {
  return crypto.randomUUID();
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function createSession(db: D1Database, userId: string): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await db
    .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, userId, expiresAt)
    .run();
  return token;
}

export async function getUserIdFromToken(db: D1Database, token: string | null): Promise<string | null> {
  if (!token) return null;
  const row = await db
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?")
    .bind(token)
    .first<{ user_id: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) return null;
  return row.user_id;
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

export async function hasActivePlan(db: D1Database, userId: string, minPlans: string[]): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `SELECT plan FROM subscriptions
       WHERE user_id = ? AND status = 'active' AND (current_period_end IS NULL OR current_period_end > ?)
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(userId, now)
    .first<{ plan: string }>();
  return !!row && minPlans.includes(row.plan);
}

export async function getUser(db: D1Database, token: string | null): Promise<{ id: string; email: string } | null> {
  const userId = await getUserIdFromToken(db, token);
  if (!userId) return null;
  return db.prepare("SELECT id, email FROM users WHERE id = ?").bind(userId).first<{ id: string; email: string }>();
}

// Admin = email listé dans le secret ADMIN_EMAILS (séparés par des virgules).
export function isAdminEmail(env: Env, email: string): boolean {
  return (env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export async function getActivePlan(db: D1Database, userId: string): Promise<{ plan: string; current_period_end: number | null } | null> {
  const now = Math.floor(Date.now() / 1000);
  return db
    .prepare(
      `SELECT plan, current_period_end FROM subscriptions
       WHERE user_id = ? AND status = 'active' AND (current_period_end IS NULL OR current_period_end > ?)
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(userId, now)
    .first<{ plan: string; current_period_end: number | null }>();
}
