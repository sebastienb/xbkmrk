// Chat completions for tagging + digest copy. Two backends, picked by
// LLM_PROVIDER: the local LM Studio model (OpenAI-compatible
// /v1/chat/completions, same host + API key as embeddings) or the Codex CLI
// (`codex exec`, ChatGPT-plan auth from the mounted ~/.codex). Returns null
// on any failure — LLM output is always optional garnish, never a blocker.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "./env.js";

// Is a chat backend configured at all? (Callers skip work entirely if not.)
export function llmAvailable(): boolean {
  if (env.llmProvider === "codex") return true;
  return Boolean(env.embeddingApiUrl && env.taggingModel);
}

function chatUrl(): string {
  // EMBEDDING_API_URL points at .../v1/embeddings on the same LM Studio host
  return env.embeddingApiUrl.replace(/\/embeddings\/?$/, "/chat/completions");
}

// `codex exec` prints progress to stdout; the reliable channel for the final
// answer is --output-last-message. Prompt goes via stdin ("-") to dodge
// arg-length and quoting issues.
async function codexComplete(system: string, user: string): Promise<string | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "codex-"));
  const outFile = path.join(dir, "last.txt");
  try {
    const args = [
      "exec",
      "--skip-git-repo-check",
      "-s", env.codexSandbox,
      "--output-last-message", outFile,
    ];
    if (env.codexModel) args.push("-m", env.codexModel);
    args.push("-");

    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn("codex", args, { stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (d) => { stderr += d; });
      const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
      child.on("error", (err) => {
        clearTimeout(timer);
        console.warn(`codex: ${err.message}`);
        resolve(false);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          const lastErr = stderr.split("\n").filter((l) => l.includes("ERROR")).at(-1);
          console.warn(`codex: exit ${code} — ${lastErr ?? stderr.slice(-200).trim()}`);
        }
        resolve(code === 0);
      });
      child.stdin.write(`${system}\n\n${user}`);
      child.stdin.end();
    });
    if (!ok) return null;
    const text = (await readFile(outFile, "utf8")).trim();
    return text || null;
  } catch (err) {
    console.warn(`codex: ${(err as Error).message}`);
    return null;
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// qwen-style models often emit <think> blocks before the answer — strip them.
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function chatComplete(system: string, user: string, maxTokens = 2000): Promise<string | null> {
  if (env.llmProvider === "codex") return codexComplete(system, user);
  if (!env.embeddingApiUrl || !env.taggingModel) return null;
  try {
    const res = await fetch(chatUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.embeddingApiKey ? { authorization: `Bearer ${env.embeddingApiKey}` } : {}),
      },
      body: JSON.stringify({
        model: env.taggingModel,
        temperature: 0.1,
        max_tokens: maxTokens, // headroom for models that emit thinking tokens
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      console.warn(`llm: endpoint returned ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content;
    return content ? stripThinking(content) || null : null;
  } catch (err) {
    console.warn(`llm: ${(err as Error).message}`);
    return null;
  }
}
