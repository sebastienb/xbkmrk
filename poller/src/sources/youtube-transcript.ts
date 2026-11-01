// Subtitle/transcript extraction for YouTube videos, no API key.
//
// The watch page's caption urls stopped working for plain HTTP clients in
// 2024 (they need a proof-of-origin token and return empty bodies). The
// InnerTube player API queried as the ANDROID client still hands out
// caption urls that work — the same route yt-dlp and the transcript
// libraries use. The url returns srv3 XML (<timedtext format="3">), which
// we fold into readable paragraphs with [m:ss] markers.
//
// Contract: resolves null when the video has no captions or isn't playable
// (callers mark it checked and never retry); THROWS on transient trouble
// (network, API/markup drift, rejected caption url) so callers leave it
// un-marked and retry on a later run.
import { JSDOM } from "jsdom";

const ANDROID_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 11)";
const ANDROID_CLIENT = {
  clientName: "ANDROID",
  clientVersion: "20.10.38",
  androidSdkVersion: 30,
  hl: "en",
};

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string; // "asr" = auto-generated
}

export interface Transcript {
  text: string;
  lang: string | null;
  auto: boolean; // auto-generated (ASR) vs manually provided subtitles
}

async function fetchPlayer(videoId: string): Promise<any> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": ANDROID_UA },
    body: JSON.stringify({ context: { client: ANDROID_CLIENT }, videoId }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`player api ${res.status}`);
  return res.json();
}

// Manual subtitles beat ASR; English beats other languages (arbitrary but
// stable — the archive's search language is English).
function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const en = (t: CaptionTrack) => (t.languageCode ?? "").startsWith("en");
  const manual = (t: CaptionTrack) => t.kind !== "asr";
  return (
    tracks.find((t) => manual(t) && en(t)) ??
    tracks.find(manual) ??
    tracks.find(en) ??
    tracks[0] ??
    null
  );
}

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// srv3: <p t="startMs" d="durMs">text</p>, ASR words as <s> children and
// bare-newline paragraphs marked a="1". Fold into ~30s paragraphs, each
// opening with its timestamp — the reading view turns those into seek
// targets, so shorter paragraphs mean tighter jumps.
function formatSrv3(xml: string): string {
  const doc = new JSDOM(xml, { contentType: "text/xml" }).window.document;
  const paragraphs: string[] = [];
  let para: string[] = [];
  let paraStart = 0;

  for (const p of Array.from(doc.getElementsByTagName("p"))) {
    if (p.getAttribute("a") === "1") continue; // append/newline marker
    const text = (p.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const t = parseInt(p.getAttribute("t") ?? "0", 10) || 0;
    if (para.length === 0) paraStart = t;
    para.push(text);
    if (t - paraStart >= 30_000) {
      paragraphs.push(`[${fmtTime(paraStart)}] ${para.join(" ")}`);
      para = [];
    }
  }
  if (para.length > 0) paragraphs.push(`[${fmtTime(paraStart)}] ${para.join(" ")}`);
  return paragraphs.join("\n\n");
}

export async function fetchTranscript(videoId: string): Promise<Transcript | null> {
  const player = await fetchPlayer(videoId);

  const status = player?.playabilityStatus?.status;
  if (!status) throw new Error("player api returned no playabilityStatus");
  if (status !== "OK") {
    // age-restricted, removed, private… — captions permanently unreachable
    console.warn(`youtube: transcript for ${videoId} unavailable (${status})`);
    return null;
  }

  const tracks: CaptionTrack[] = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const track = pickTrack(tracks);
  if (!track?.baseUrl) return null; // playable video, just no captions

  const ttRes = await fetch(track.baseUrl, {
    headers: { "user-agent": ANDROID_UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!ttRes.ok) throw new Error(`timedtext ${ttRes.status}`);
  const body = await ttRes.text();
  if (!body.trim()) throw new Error("timedtext empty (caption url rejected?)");

  const text = formatSrv3(body).slice(0, 1_000_000);
  if (!text) return null;
  return { text, lang: track.languageCode ?? null, auto: track.kind === "asr" };
}
