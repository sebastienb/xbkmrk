// Applies db/migrations/*.sql in filename order, idempotently, tracked in schema_migrations.
// Also (re)sets the bookmarks_ro password from MCP_DB_PASSWORD / DB_PASSWORD.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || "/app/db/migrations";

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      "create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now())",
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const { rows } = await client.query("select 1 from schema_migrations where filename = $1", [file]);
      if (rows.length > 0) {
        console.log(`skip   ${file}`);
        continue;
      }
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`apply  ${file}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }

    // keep the read-only role's password in sync with env
    const roPassword = process.env.MCP_DB_PASSWORD || process.env.DB_PASSWORD;
    if (roPassword) {
      const { rows } = await client.query("select 1 from pg_roles where rolname = 'bookmarks_ro'");
      if (rows.length > 0) {
        try {
          // identifiers can't be parameterized; role name is a constant, password must be escaped
          await client.query(`alter role bookmarks_ro password '${roPassword.replace(/'/g, "''")}'`);
          console.log("set    bookmarks_ro password");
        } catch (err) {
          // on a shared Postgres the app role can't alter other roles;
          // the platform admin owns bookmarks_ro's password there
          if ((err as { code?: string }).code === "42501") {
            console.warn("skip   bookmarks_ro password sync (insufficient privilege; managed externally)");
          } else {
            throw err;
          }
        }
      }
    }
    console.log("migrations complete");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
