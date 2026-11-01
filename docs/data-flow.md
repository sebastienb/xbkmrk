# Data flow: intakes, processing, storage, and AI

How a bookmark gets into the archive, what happens to it on the way in, what ends up
stored, and exactly what is sent to an LLM (and what it writes back).

## The big picture

Four intake paths feed one shared pipeline. Everything converges on the same tables, and
every row — regardless of origin — gets the same downstream treatment: embedding,
link enrichment, and auto-tagging.

```mermaid
flowchart LR
  subgraph intakes ["Intakes"]
    X["X API v2<br/>bookmarks + likes"]
    BM["Bookmarklet<br/>GET /api/save"]
    IOS["iOS Shortcut / extension<br/>POST /api/save"]
    YT["YouTube playlists<br/>RSS · scrape · Data API"]
  end

  subgraph poller ["Poller (local pipeline)"]
    SYNC["runSync"]
    BF["runBackfills<br/>transcripts → embeddings → enrichment → tags"]
  end

  subgraph store ["Storage"]
    DB[("Postgres + pgvector<br/>bookmarks · authors · media<br/>link_content · digests")]
    FS["data/media/<br/>photos · videos · og images"]
  end

  subgraph ai ["AI"]
    EMB["Embedding model<br/>/v1/embeddings"]
    CHAT["Chat model<br/>LM Studio or Codex CLI"]
  end

  subgraph consumers ["Consumers"]
    WEB["Web reader :3020"]
    MCP["MCP server :3021"]
    DIG["Weekly digest"]
  end

  X --> SYNC
  YT --> SYNC
  BM -- "NOTIFY enrich_request" --> BF
  IOS -- "NOTIFY enrich_request" --> BF
  SYNC --> BF
  SYNC --> DB
  SYNC --> FS
  BF --> DB
  BF --> FS
  BF <--> EMB
  BF <--> CHAT
  DB --> WEB
  DB --> MCP
  DB --> DIG
  DIG <--> CHAT
```

Sync triggers: `SYNC_CRON` (optional), opening the web app when the last sync is older
than `SYNC_ON_ACCESS_HOURS` (`NOTIFY sync_request`), the header's Sync now button, and
poller boot when overdue.

---

## Intake 1 — X bookmarks & likes (X API)

The poller pages each stream newest-first and **stops at the first already-seen post**
(X bills per post read, so this is the cost control). First page asks for 25 posts,
deeper pages 100. The likes stream additionally stops at posts older than
`LIKES_MAX_AGE_DAYS`.

```mermaid
flowchart TD
  A["GET /2/users/:id/bookmarks<br/>GET /2/users/:id/liked_tweets<br/>(expansions: author, referenced tweets, media)"] --> B{"post already<br/>stored?"}
  B -- "yes → stop paging" --> Z["record usage:<br/>x_api_usage + x_usage_snapshot"]
  B -- no --> C["extract per post"]
  C --> C1["text — note_tweet long text,<br/>or X Article title + plain_text"]
  C --> C2["author profile → authors table<br/>(handle, name, avatar, banner)"]
  C --> C3["referenced tweets → jsonb<br/>(quoted / replied / RT: text + author)"]
  C --> C4["entity urls → urls jsonb"]
  C --> C5["media list + alt text"]
  C --> C6["public_metrics, lang, raw json"]
  C5 --> D["download photos / video variants<br/>→ data/media/&lt;post-id&gt;/"]
  C1 --> E["embed: text + quoted texts + alt texts"]
  C3 --> E
  C5 --> E
  E --> F[("insert bookmarks row<br/>id = X post id (string!)<br/>bookmarked / liked flag by stream")]
  D --> G[("media rows<br/>type · local_path · alt · dimensions")]
  C --> H{"is X Article?"}
  H -- yes --> I[("link_content row kind=x_article<br/>title · preview · plain_text<br/>+ cover image as media row")]
```

What is **not** fetched here: linked-page content, tags, transcripts — those all come
from the shared backfill pipeline after the stream sync.

## Intake 2 — Web saves (bookmarklet, iOS Shortcut, browser extension)

This path **records intent only** — no page is fetched by the web app. The poller's
pipeline does the fetching moments later.

```mermaid
sequenceDiagram
  participant U as Browser / iPhone
  participant W as web /api/save
  participant DB as Postgres
  participant P as poller

  U->>W: GET (bookmarklet popup) or POST JSON<br/>{url, title?, selected text?} + SAVE_TOKEN
  W->>DB: token check (app_settings.SAVE_TOKEN)
  W->>DB: dedup by url (source='web')
  alt already saved
    W->>DB: clear read_at (resurfaces in Saves)
    W-->>U: "Already saved ✓"
  else new
    W->>DB: insert bookmarks row<br/>id from web_save_id seq · source='web'<br/>text = title + selection · urls[0] = url
    W->>DB: NOTIFY enrich_request
    W-->>U: "Saved ✓"
  end
  P->>DB: LISTEN enrich_request → runBackfills()
  Note over P: fetches the page, embeds,<br/>tags — see shared pipeline
```

Extracted at intake: URL, page title (≤500 chars), selected text (≤2000 chars),
`saved_via` provenance in `raw`. Everything else (article content, og image,
description, embedding, tags) arrives via the shared pipeline.

Sharing an **X post** this way is a special case: x.com can't be scraped, so the
pipeline hydrates the bookmark from X's free syndication endpoint (the JSON behind
embedded-tweet widgets — no API credits). That rebuilds the bookmark as if it had
arrived via the API sync: real post text, an `authors` row (avatar, handle), post
date, like/reply counts, the quoted post, and **downloaded media** (full-size photos,
best-bitrate mp4). If the post links out, that link then goes through the normal
enrichment (article / GitHub README / og image); otherwise a `kind='x_post'` marker
row identifies it to the UI, which shows an "Open on X" button and a "Saved from X"
badge. When syndication fails, an oEmbed fallback still recovers author + text.
Long posts may be truncated to the classic preview length — full note text needs the
paid API.

## Intake 3 — YouTube playlists

Configured in Settings → Sources (`YOUTUBE_PLAYLISTS`). Runs at the **start** of every
sync (an X API failure never blocks it) and immediately when the playlist settings
change.

```mermaid
flowchart TD
  S{"YOUTUBE_API_KEY set?"} -- yes --> API["Data API playlistItems<br/>full pagination<br/>savedAt = added-to-playlist date<br/>createdAt = upload date"]
  S -- "no (keyless)" --> RSS["RSS feed (~15 newest, 404s for unlisted)<br/>+ playlist page scrape (~100 ids)<br/>+ oEmbed for missing metadata"]
  API --> ITEM["per video: title · description ·<br/>channel · thumbnail · dates"]
  RSS --> ITEM
  ITEM --> TR{"YOUTUBE_TRANSCRIPTS on?"}
  TR -- yes --> IT["InnerTube player call (ANDROID client)<br/>→ caption track → srv3 XML<br/>→ text with [m:ss] timestamps"]
  TR -- no --> ING
  IT --> ING["shared external ingest"]
  ING --> B1[("bookmarks row<br/>id from web_save_id · source='youtube'<br/>text = title + description<br/>embedding at insert (incl. transcript head)")]
  ING --> B2[("link_content row kind='video'<br/>content = transcript · content_fts")]
  ING --> B3["thumbnail → data/media/og/"]
  ING --> B4["transcript ok/none marker in raw<br/>(none = never retried; error = retried)"]
```

A transcript **backfill** pass (part of `runBackfills`) later fetches transcripts for
videos ingested before the feature existed or that failed transiently, then re-embeds
the bookmark with the transcript folded in. If an API key is added after a keyless
import, dates are silently corrected (`backdateExternalItem`).

---

## Shared processing pipeline (`runBackfills`)

Runs after every sync and whenever a web save NOTIFYs `enrich_request`. Local HTTP
only — never touches the X API. Order matters: transcripts update content that
embeddings and tags build on.

```mermaid
flowchart TD
  START["runBackfills"] --> S1["1 · source backfills<br/>(YouTube transcripts → link_content.content,<br/>re-embed)"]
  S1 --> S2["2 · embedding backfill<br/>rows where embedding is null<br/>(endpoint was down at insert)"]
  S2 --> S3["3 · link enrichment<br/>new posts + up to 25 older un-enriched"]
  S3 --> S4["4 · auto-tagging<br/>up to 30 untagged posts"]

  S3 --> P{"primary url?<br/>(first non-X/t.co url)"}
  P -- "none, but web save<br/>of an x.com post" --> XP["free syndication endpoint:<br/>text · author row · media downloads ·<br/>metrics · quoted post · post date → re-embed;<br/>external link → normal enrichment,<br/>else kind=x_post marker<br/>(oEmbed fallback: author + text)"]
  P -- none --> N[("link_content status=no_link")]
  P -- "github.com repo" --> GH["GitHub API:<br/>repo meta + README markdown (≤500 KB)<br/>og card image"]
  P -- other --> AR["fetch page ≤3 MB<br/>(Instagram/Facebook: FB-crawler UA —<br/>browsers get a blank shell)"]
  AR --> OG["og/twitter meta:<br/>title · description · site name · image"]
  AR --> RD["Readability article extraction<br/>→ sanitized HTML ≤1 MB<br/>(only if &gt;200 chars of text)"]
  GH --> LC[("upsert link_content<br/>kind · title · description ·<br/>content · content_fts · status")]
  OG --> LC
  RD --> LC
  OG --> IMG["download og image<br/>→ data/media/og/&lt;id&gt;.jpg"]
  IMG --> LC
```

Enrichment failures are recorded (`status=failed`) and never retried; they never block
a sync. Embedding failures leave `embedding` null and are retried next run.

---

## What gets sent to AI — and what it updates

Two model roles, both configurable in Settings → AI:

- **Embedding model** — OpenAI-compatible `/v1/embeddings` (LM Studio / Ollama,
  `nomic-embed-text` by default). Input truncated to 8000 chars.
- **Chat model** — either the same LM Studio host (`/v1/chat/completions`,
  `TAGGING_MODEL`) or the Codex CLI (`LLM_PROVIDER=codex`).

```mermaid
flowchart LR
  subgraph inputs ["What is sent"]
    I1["post text + quoted-tweet texts<br/>+ image alt texts (X posts)"]
    I2["title + description +<br/>transcript/article head (external items)"]
    I3["post text + link title +<br/>link description (≤4000 chars)<br/>+ tag vocabulary"]
    I4["per-post context: author, text,<br/>link title/description (≤4000 chars)"]
    I5["section titles + blurbs"]
  end

  subgraph models ["Model"]
    E["embedding model"]
    C["chat model"]
  end

  subgraph writes ["What it updates"]
    O1[("bookmarks.embedding<br/>vector(768)")]
    O2[("bookmarks.tags (1–3)<br/>+ auto_tagged_at")]
    O3[("digests.content:<br/>blurbs · section ledes ·<br/>headline · editor's note")]
  end

  I1 --> E
  I2 --> E
  E --> O1
  I3 -- auto-tag --> C
  C --> O2
  I4 -- "digest blurbs" --> C
  I5 -- "ledes + editorial" --> C
  C --> O3
```

| AI task | Trigger | Exact input | Updates | Failure behavior |
|---|---|---|---|---|
| Embedding | at insert; backfill for nulls; re-embed after transcript | post text + quoted texts + alt texts, or title + description + content head (≤8000 chars) | `bookmarks.embedding` | null vector, retried next run — never blocks ingestion |
| Auto-tag | backfill, ≤30/run, only `tags='{}'` **and** never attempted | text + link title + link description (≤4000 chars), seed + DB tag vocabulary in the prompt | `bookmarks.tags` (1–3 normalized kebab-case tags), `auto_tagged_at` | left untagged, retried; manual tags are never touched |
| Digest blurbs | weekly `DIGEST_CRON` / on demand | per post: author, text, link title, link description (≤4000 chars) | `digests.content` (per-post summaries) | falls back to raw excerpts |
| Section ledes | during digest, sections with ≥3 items | section title + up to 8 blurbs (200 chars each) | `digests.content` sections | lede omitted |
| Editorial | during digest | lead blurb + section overview | `digests.content` headline + editor's note | both null, digest still publishes |

**Never sent to any model:** media files, raw API JSON, full article/README bodies for
tagging (title + description only), auth tokens. Everything sent goes to *your own*
endpoint (local LM Studio/Ollama or your Codex account) — there is no third-party AI
service baked in.

---

## Storage map

```mermaid
erDiagram
  authors ||--o{ bookmarks : "author_id"
  bookmarks ||--o{ media : "bookmark_id"
  bookmarks ||--o| link_content : "bookmark_id"
  bookmarks {
    text id PK "X post id or web_save_id seq"
    text source "x | web | youtube"
    text text "post / title + selection"
    jsonb urls "urls[0] = dedup key for web/youtube"
    jsonb referenced "quoted / replied tweets"
    jsonb metrics
    jsonb raw "provenance + transcript markers"
    vector embedding "768-dim"
    text_arr tags
    timestamptz auto_tagged_at
    bool bookmarked
    bool liked
    timestamptz read_at
  }
  authors {
    text id PK
    text username
    text name
    text avatar_url
    text profile_banner_url
  }
  media {
    text media_key PK
    text type "photo | video | animated_gif"
    text local_path "under data/media/"
    text alt_text
  }
  link_content {
    text bookmark_id PK
    text kind "article | github | video | x_article | other"
    text title
    text description
    text content "article HTML / README md / transcript"
    tsvector content_fts "generated, GIN-indexed"
    text og_image_path "data/media/og/"
    text status "ok | no_content | no_link | failed"
  }
  digests {
    int id PK
    timestamptz period_start
    timestamptz period_end
    jsonb content "ids + editorial copy only"
  }
```

Supporting tables: `oauth_token` (rotating X refresh token — lives here, never in
`.env`), `sync_state`, `app_settings` (DB-backed settings incl. `SAVE_TOKEN`, auth
hash), `mcp_auth` (MCP bearer token), `digest_state` (live progress),
`x_api_usage` / `x_usage_snapshot` (cost meter). On disk: `data/media/<post-id>/`
(photos, videos) and `data/media/og/` (link thumbnails). Back up `data/` + the
`xbm_pgdata` volume.

## Who reads what

| Consumer | Reads | Notes |
|---|---|---|
| Web reader | everything via `bookmarks_ro`-equivalent queries | keyword search = FTS over text **and** `content_fts` (articles, READMEs, transcripts, weight 0.8); semantic = pgvector cosine; hybrid = both |
| MCP server (`:3021/mcp`) | read-only role `bookmarks_ro` | `search_bookmarks`, `get_unread`, `recommend`, `get_bookmark` (returns full content incl. transcripts); bearer-token authed |
| Weekly digest | week's posts + embeddings | lead by engagement, sections by tag, liked-only posts in a rail box, archive pick = pgvector nearest to the week's centroid |
