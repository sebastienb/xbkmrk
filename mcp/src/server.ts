// MCP server exposing the bookmark archive to AI agents.
// Streamable HTTP transport (stateless) on PORT (default 3021), path /mcp.
// Connects with the read-only bookmarks_ro role.
import { timingSafeEqual } from "node:crypto";
import express from "express";
import pg from "pg";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const PORT = parseInt(process.env.PORT || "3021", 10);

// ---- helpers -------------------------------------------------------------

async function embedQuery(text: string): Promise<number[] | null> {
  const url = process.env.EMBEDDING_API_URL;
  if (!url) return null;
  try {
    const key = process.env.EMBEDDING_API_KEY;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ model: process.env.EMBEDDING_MODEL || "nomic-embed-text", input: text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vec = json.data?.[0]?.embedding;
    return Array.isArray(vec) ? vec : null;
  } catch {
    return null;
  }
}

const ROW_SELECT = `
  select b.id::text as id, b.text, b.is_long, b.created_at, b.saved_at, b.read_at,
         b.notes, b.tags, b.urls, b.referenced, b.lang, b.source,
         a.username as author_username, a.name as author_name,
         coalesce(m.items, '[]'::jsonb) as media, l.link
  from bookmarks b
  left join authors a on a.id = b.author_id
  left join lateral (
    select jsonb_agg(jsonb_build_object('type', type, 'local_path', local_path, 'alt_text', alt_text)) as items
    from media where bookmark_id = b.id
  ) m on true
  left join lateral (
    select case when lc.status in ('ok', 'no_content') then jsonb_build_object(
      'url', lc.url, 'kind', lc.kind, 'title', lc.title, 'site_name', lc.site_name,
      'description', lc.description,
      'has_content', lc.content is not null) end as link
    from link_content lc where lc.bookmark_id = b.id
  ) l on true`;

function toResult(rows: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
}

// Hybrid keyword + vector search (RRF); keyword-only when embeddings unavailable.
async function hybridSearch(query: string, limit: number) {
  const vec = await embedQuery(query);
  if (!vec) {
    const { rows } = await pool.query(
      `with ranked as (
         select b.id, greatest(
                  ts_rank(to_tsvector('english', b.text), websearch_to_tsquery('english', $1)),
                  coalesce(ts_rank(flc.content_fts, websearch_to_tsquery('english', $1)) * 0.8, 0)
                ) as score
         from bookmarks b
         left join link_content flc on flc.bookmark_id = b.id
         where to_tsvector('english', b.text) @@ websearch_to_tsquery('english', $1)
            or flc.content_fts @@ websearch_to_tsquery('english', $1)
         order by score desc limit $2
       )
       ${ROW_SELECT}
       join ranked r on r.id = b.id
       order by r.score desc`,
      [query, limit],
    );
    return rows;
  }
  const { rows } = await pool.query(
    `with kw as (
       select b.id, row_number() over (
         order by greatest(
           ts_rank(to_tsvector('english', b.text), websearch_to_tsquery('english', $1)),
           coalesce(ts_rank(flc.content_fts, websearch_to_tsquery('english', $1)) * 0.8, 0)
         ) desc) as rn
       from bookmarks b
       left join link_content flc on flc.bookmark_id = b.id
       where to_tsvector('english', b.text) @@ websearch_to_tsquery('english', $1)
          or flc.content_fts @@ websearch_to_tsquery('english', $1)
       limit 60
     ),
     sem as (
       select b.id, row_number() over (order by b.embedding <=> $2::vector) as rn
       from bookmarks b
       where b.embedding is not null
       order by b.embedding <=> $2::vector
       limit 60
     ),
     ranked as (
       select coalesce(kw.id, sem.id) as id,
              coalesce(1.0 / (60 + kw.rn), 0) + coalesce(1.0 / (60 + sem.rn), 0) as score
       from kw full outer join sem using (id)
       order by score desc limit $3
     )
     ${ROW_SELECT}
     join ranked r on r.id = b.id
     order by r.score desc`,
    [query, `[${vec.join(",")}]`, limit],
  );
  return rows;
}

// ---- MCP server ----------------------------------------------------------

function buildServer(): McpServer {
  const server = new McpServer({ name: "x-bookmark-archive", version: "1.0.0" });

  server.registerTool(
    "search_bookmarks",
    {
      title: "Search bookmarks",
      description:
        "Search the bookmark archive (X posts, web saves, YouTube playlist videos) with " +
        "hybrid keyword + semantic search. Keywords also match inside stored link content — " +
        "article text, READMEs, and video transcripts. Results include a `link` summary with " +
        "has_content; call get_bookmark to read the full content.",
      inputSchema: {
        query: z.string().describe("Search query (natural language or keywords)"),
        limit: z.number().int().min(1).max(50).default(10).describe("Max results"),
      },
    },
    async ({ query, limit }) => toResult(await hybridSearch(query, limit)),
  );

  server.registerTool(
    "get_unread",
    {
      title: "Get unread bookmarks",
      description: "List bookmarks not yet marked as read, newest saved first.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(10).describe("Max results"),
      },
    },
    async ({ limit }) => {
      const { rows } = await pool.query(
        `${ROW_SELECT} where b.read_at is null order by b.saved_at desc limit $1`,
        [limit],
      );
      return toResult(rows);
    },
  );

  server.registerTool(
    "get_recent",
    {
      title: "Get recent bookmarks",
      description:
        "List the most recently saved bookmarks, newest first, regardless of read state. " +
        "Ordered by when the item landed in the archive (saved_at), not by original post date.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(10).describe("Max results"),
        source: z
          .string()
          .optional()
          .describe("Filter by source: 'x', 'web', 'youtube', … (omit for all sources)"),
      },
    },
    async ({ limit, source }) => {
      const { rows } = await pool.query(
        `${ROW_SELECT}
         where ($2::text is null or b.source = $2)
         order by b.saved_at desc limit $1`,
        [limit, source?.trim().toLowerCase() || null],
      );
      return toResult(rows);
    },
  );

  server.registerTool(
    "recommend",
    {
      title: "Recommend bookmarks",
      description:
        "Recommend bookmarks semantically similar to a context string " +
        "(e.g. what the user is currently working on or recently read).",
      inputSchema: {
        context: z.string().describe("Free-text context to match against"),
        limit: z.number().int().min(1).max(50).default(5).describe("Max results"),
      },
    },
    async ({ context, limit }) => {
      const vec = await embedQuery(context);
      if (!vec) {
        // graceful degradation: fall back to hybrid (which degrades to keyword)
        return toResult(await hybridSearch(context, limit));
      }
      const { rows } = await pool.query(
        `${ROW_SELECT}
         where b.embedding is not null
         order by b.embedding <=> $1::vector
         limit $2`,
        [`[${vec.join(",")}]`, limit],
      );
      return toResult(rows);
    },
  );

  server.registerTool(
    "get_bookmark",
    {
      title: "Get bookmark",
      description:
        "Fetch one bookmark by id, including notes, tags, referenced posts, media paths, " +
        "and the FULL stored content of its link when available: extracted article text, " +
        "GitHub README, or the complete video transcript (YouTube saves). " +
        "Use this after a search when you need to read what a bookmark actually contains.",
      inputSchema: {
        id: z.string().regex(/^\d+$/).describe("Bookmark id (numeric string, from search results)"),
      },
    },
    async ({ id }) => {
      const { rows } = await pool.query(`${ROW_SELECT} where b.id = $1::bigint`, [id]);
      if (rows.length === 0) return toResult({ error: "not found" });
      const { rows: contentRows } = await pool.query(
        "select content from link_content where bookmark_id = $1::bigint and status = 'ok'",
        [id],
      );
      return toResult({ ...rows[0], content: contentRows[0]?.content ?? null });
    },
  );

  return server;
}

// ---- auth -----------------------------------------------------------------
// Bearer token from the mcp_auth table (minted by the web app's /connect
// page — migration 0014). bookmarks_ro may read this table, unlike
// app_settings. Fail closed: no table / no row = every request rejected.

let tokenCache: { value: string | null; at: number } = { value: null, at: 0 };

async function expectedToken(fresh = false): Promise<string | null> {
  if (!fresh && Date.now() - tokenCache.at < 30_000) return tokenCache.value;
  try {
    const { rows } = await pool.query("select token from mcp_auth where id = 1");
    tokenCache = { value: rows[0]?.token ?? null, at: Date.now() };
  } catch {
    tokenCache = { value: null, at: Date.now() }; // table missing (pre-migration)
  }
  return tokenCache.value;
}

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- HTTP plumbing (stateless streamable HTTP) ----------------------------

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/mcp", async (req, res, next) => {
  const provided = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  let expected = await expectedToken();
  if (provided && (!expected || !tokenMatches(provided, expected))) {
    // token may have just been minted or rotated — re-read once before rejecting
    expected = await expectedToken(true);
  }
  if (!expected || !provided || !tokenMatches(provided, expected)) {
    res
      .status(401)
      .set("www-authenticate", "Bearer")
      .json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: expected
            ? "Unauthorized: send the bearer token from the archive's /connect page (Authorization: Bearer …)."
            : "Unauthorized: no MCP token minted yet — open the archive's /connect page once to create it.",
        },
        id: null,
      });
    return;
  }
  next();
});

app.post("/mcp", async (req, res) => {
  // stateless: fresh server + transport per request, no session tracking
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("mcp request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

const methodNotAllowed = (_req: express.Request, res: express.Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed (stateless server)" },
    id: null,
  });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.get("/health", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.listen(PORT, () => {
  console.log(`x-bookmark-archive MCP server on :${PORT}/mcp`);
});
