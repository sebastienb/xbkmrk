import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig, invalidateAuthCache, sessionValid, SESSION_COOKIE } from "@/lib/auth";

// Session gate for everything: pages, data APIs, media. Runs on the Node
// runtime (stable since Next 15.5) so it can read the auth secret from
// Postgres — cached in lib/auth, so this is not a per-request query.
//
// Deliberately open:
//  - /login + /api/auth/login  — the door itself (login route rate-limits)
//  - /api/save                 — carries its own SAVE_TOKEN (bookmarklet,
//                                browser extension, iOS shortcut)
// Note /api/save-token (which REVEALS that token) stays behind the session.
const PUBLIC = [/^\/login$/, /^\/api\/auth\/login$/, /^\/api\/save$/];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;

  let cfg = await getAuthConfig();
  let authed = cfg.passwordHash !== null && sessionValid(cookie, cfg.secret);
  if (!authed && cookie) {
    // The auth routes and this middleware are separate bundles with separate
    // caches — a just-set password or just-rotated secret isn't visible here
    // yet. Before rejecting a presented cookie, re-read the truth once.
    invalidateAuthCache();
    cfg = await getAuthConfig();
    authed = cfg.passwordHash !== null && sessionValid(cookie, cfg.secret);
  }

  if (PUBLIC.some((re) => re.test(path))) {
    // already signed in — the login page just bounces home
    if (path === "/login" && authed) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  if (authed) return NextResponse.next();

  // Until a password exists the site is locked to the setup screen — never
  // expose an unconfigured instance.
  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  if (path !== "/") login.searchParams.set("next", path);
  return NextResponse.redirect(login);
}

export const config = {
  runtime: "nodejs",
  // skip Next's own assets — everything else (pages + /api) goes through
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
