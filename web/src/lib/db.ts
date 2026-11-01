import pg from "pg";

// X ids exceed Number.MAX_SAFE_INTEGER — bigints stay strings (pg's default).
const globalForPg = globalThis as unknown as { pgPool?: pg.Pool };

export const pool =
  globalForPg.pgPool ?? (globalForPg.pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL }));
