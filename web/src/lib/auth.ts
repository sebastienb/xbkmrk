import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { pool } from "@/lib/db";

// Single-user password auth: scrypt-hashed password + HMAC-signed session
// cookie. Both the hash and the signing secret live in app_settings (kept
// out of ALLOWED_KEYS, so the settings form can neither read nor clear
// them). The middleware checks every request; /api/save stays open because
// it carries its own token (bookmarklet, extension, iOS shortcut).

export const SESSION_COOKIE = "xbm_session";
export const SESSION_DAYS = 180;

const HASH_KEY = "AUTH_PASSWORD_HASH";
const SECRET_KEY = "AUTH_SECRET";

interface AuthConfig {
  secret: string;
  passwordHash: string | null; // null = setup not done yet — site stays locked
}

// Cached for the middleware's per-request checks. The TTL is the upper bound
// on how long a REVOKED session outlives a secret rotation (the middleware
// and auth routes are separate bundles, so invalidateAuthCache can't reach
// the other's copy) — keep it small; it only needs to absorb request bursts
// like a page's grid of thumbnails.
let cached: { cfg: AuthConfig; at: number } | null = null;
const CACHE_MS = 5_000;

export function invalidateAuthCache(): void {
  cached = null;
}

export async function getAuthConfig(): Promise<AuthConfig> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.cfg;

  const { rows } = await pool.query("select key, value from app_settings where key = any($1)", [
    [HASH_KEY, SECRET_KEY],
  ]);
  const map = new Map<string, string>(rows.map((r: { key: string; value: string }) => [r.key, r.value]));

  let secret = map.get(SECRET_KEY) ?? "";
  if (!secret) {
    // first boot: mint the signing secret (race-safe like SAVE_TOKEN)
    await pool.query(
      "insert into app_settings (key, value) values ($1, $2) on conflict (key) do nothing",
      [SECRET_KEY, randomBytes(32).toString("hex")],
    );
    const { rows: r2 } = await pool.query("select value from app_settings where key = $1", [SECRET_KEY]);
    secret = r2[0].value;
  }

  const cfg: AuthConfig = { secret, passwordHash: map.get(HASH_KEY) ?? null };
  cached = { cfg, at: Date.now() };
  return cfg;
}

// ---- password hashing (scrypt, no external deps) --------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `s1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [v, saltB64, hashB64] = stored.split("$");
  if (v !== "s1" || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(hashB64, "base64url");
  const actual = scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

export async function setPassword(password: string): Promise<void> {
  await pool.query(
    `insert into app_settings (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [HASH_KEY, hashPassword(password)],
  );
  invalidateAuthCache();
}

// Rotating the secret invalidates every session cookie ("sign out everywhere").
export async function rotateSecret(): Promise<string> {
  const secret = randomBytes(32).toString("hex");
  await pool.query(
    `insert into app_settings (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [SECRET_KEY, secret],
  );
  invalidateAuthCache();
  return secret;
}

// ---- session cookies ------------------------------------------------------

function sign(exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`xbm-session:${exp}`).digest("base64url");
}

export function createSessionValue(secret: string): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600;
  return `${exp}.${sign(exp, secret)}`;
}

export function sessionValid(value: string | undefined, secret: string): boolean {
  if (!value) return false;
  const [expStr, sig] = value.split(".");
  const exp = parseInt(expStr ?? "", 10);
  if (!exp || !sig || exp * 1000 < Date.now()) return false;
  const expected = Buffer.from(sign(exp, secret));
  const actual = Buffer.from(sig);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
