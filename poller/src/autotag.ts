// Auto-tagging via the local LM Studio chat model (OpenAI-compatible
// /v1/chat/completions, same host + API key as embeddings).
//
// Rules:
// - only posts with NO tags and no prior attempt (auto_tagged_at is null)
// - never touches manually tagged posts; a user clearing tags won't get
//   them re-added (the attempt timestamp persists)
// - seeded vocabulary + existing DB tags; the model prefers those but may
//   coin a new tag when nothing fits (vocabulary grows organically)
import { pool } from "./db.js";
import { chatComplete, llmAvailable } from "./llm.js";

const SEED_VOCAB = [
  "ai", "llm", "agents", "coding", "dev-tools", "open-source", "apple", "ios",
  "web", "design", "startup", "business", "crypto", "security", "hardware",
  "science", "health", "sports", "gaming", "humor", "politics", "finance",
];

function normalizeTag(raw: string): string | null {
  const tag = raw.toLowerCase().trim().replace(/^#/, "").replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  if (!tag || tag.length > 30) return null;
  return tag;
}

// qwen-style models often prefix the answer with thinking prose — take the
// LAST JSON array in the text (the final answer), not the first.
function parseTags(text: string): string[] | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const matches = cleaned.match(/\[[\s\S]*?\]/g);
  if (!matches || matches.length === 0) return null;
  try {
    const arr = JSON.parse(matches[matches.length - 1]);
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((t): t is string => typeof t === "string")
      .map(normalizeTag)
      .filter((t): t is string => t !== null)
      .slice(0, 3);
  } catch {
    return null;
  }
}

async function suggestTags(text: string, vocab: string[]): Promise<string[] | null> {
  const content = await chatComplete(
    "You tag saved social media posts for a personal bookmark archive. " +
      "Reply with ONLY a JSON array of 1-3 topic tags, e.g. [\"ai\",\"coding\"]. " +
      "Strongly prefer tags from this vocabulary:\n" +
      vocab.join(", ") +
      "\nOnly invent a new tag (lowercase, kebab-case) when none of these fit. No explanations.",
    text.slice(0, 4000),
  );
  return content ? parseTags(content) : null;
}

async function currentVocab(): Promise<string[]> {
  const { rows } = await pool.query(
    "select distinct unnest(tags) as tag from bookmarks order by 1",
  );
  const dbTags = rows.map((r: { tag: string }) => r.tag);
  return [...new Set([...SEED_VOCAB, ...dbTags])];
}

// Tag up to `limit` untagged posts. Returns how many were processed.
export async function backfillTags(limit = 30): Promise<number> {
  if (!llmAvailable()) return 0;

  const { rows } = await pool.query(
    `select b.id::text as id, b.text, lc.title as link_title, lc.description as link_description
     from bookmarks b
     left join link_content lc on lc.bookmark_id = b.id
     where b.tags = '{}' and b.auto_tagged_at is null
     order by b.saved_at desc
     limit $1`,
    [limit],
  );
  if (rows.length === 0) return 0;

  const vocab = await currentVocab();
  let tagged = 0;
  for (const row of rows) {
    const context = [row.text, row.link_title, row.link_description].filter(Boolean).join("\n\n");
    const tags = await suggestTags(context, vocab);
    if (tags === null) {
      // endpoint down or unparseable — leave auto_tagged_at null so we retry next run
      continue;
    }
    await pool.query(
      "update bookmarks set tags = $2, auto_tagged_at = now() where id = $1 and tags = '{}'",
      [row.id, tags],
    );
    tagged++;
    // newly coined tags join the vocabulary for subsequent posts this run
    for (const t of tags) if (!vocab.includes(t)) vocab.push(t);
  }
  return tagged;
}
