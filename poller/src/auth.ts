// One-time OAuth 2.0 PKCE flow. Run with: npm run auth
// Stores the (rotating) refresh token in the oauth_token table.
//
// Works two ways simultaneously:
//   1. A local listener on :3022 catches the redirect automatically
//      (when your browser runs on the same machine, or via `ssh -L 3022:localhost:3022 <server>`).
//   2. If the redirect can't reach the listener, paste the full redirect URL
//      (from your browser's address bar) into this terminal.
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { randomBytes, createHash } from "node:crypto";
import { env } from "./env.js";
import { saveToken, pool } from "./db.js";
import { exchangeToken } from "./xclient.js";
import { initSettings } from "./settings.js";

const SCOPES = "tweet.read users.read bookmark.read like.read offline.access";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function main() {
  await initSettings(); // client id may live in app_settings rather than env
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  const authUrl = new URL("https://x.com/i/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", env.xClientId);
  authUrl.searchParams.set("redirect_uri", env.xRedirectUri);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  console.log("\n1. Open this URL in your browser and authorize the app:\n");
  console.log(authUrl.toString());
  console.log(`\n2. You'll be redirected to ${env.xRedirectUri}`);
  console.log("   If that page fails to load, paste the FULL redirect URL here and press enter.\n");

  const code = await waitForCode(state);
  console.log("\nExchanging code for tokens…");
  const tokens = await exchangeToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.xRedirectUri,
    code_verifier: verifier,
  });
  await saveToken({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000),
  });
  console.log("✓ Tokens stored in oauth_token table. The poller can sync now.");
  await pool.end();
  process.exit(0);
}

function extractCode(rawUrl: string, expectedState: string): string | null {
  try {
    const u = new URL(rawUrl, "http://localhost");
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state");
    if (!code) return null;
    if (state !== expectedState) {
      console.error("state mismatch — ignoring");
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

function waitForCode(expectedState: string): Promise<string> {
  return new Promise((resolve) => {
    const port = parseInt(new URL(env.xRedirectUri).port || "3022", 10);

    const server = createServer((req, res) => {
      const code = req.url ? extractCode(req.url, expectedState) : null;
      if (code) {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<h3>Authorized. You can close this tab.</h3>");
        cleanup();
        resolve(code);
      } else {
        res.writeHead(400);
        res.end("missing/invalid code");
      }
    });
    server.on("error", (err) => console.warn(`(listener unavailable: ${err.message} — paste the redirect URL instead)`));
    server.listen(port, "0.0.0.0");

    const rl = createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      const code = extractCode(line.trim(), expectedState);
      if (code) {
        cleanup();
        resolve(code);
      } else if (line.trim()) {
        console.error("Could not parse a ?code= out of that — paste the full redirect URL.");
      }
    });

    function cleanup() {
      server.close();
      rl.close();
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
