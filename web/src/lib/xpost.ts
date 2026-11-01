// A web save (bookmarklet / iOS shortcut) whose saved url is an X post.
// urls[0] is the save's dedup key, so it always holds the original X url even
// after enrichment rewrites the rest of the bookmark. Detection can't use
// link_content.kind: when the post links out, the link row describes the
// linked page (article/github), not the post.
const X_STATUS = /^https?:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\/[^/]+\/status(?:es)?\/\d+/;

export function savedXPostUrl(b: { source: string; urls: Array<{ expanded_url: string }> | null }): string | null {
  if (b.source !== "web") return null;
  const u = b.urls?.[0]?.expanded_url;
  return u && X_STATUS.test(u) ? u : null;
}
