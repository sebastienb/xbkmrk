import { NextRequest, NextResponse } from "next/server";
import {
  createSessionValue, getAuthConfig, sessionValid, setPassword, verifyPassword,
  SESSION_COOKIE, SESSION_DAYS,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

// Brute-force throttle: after 5 straight failures, lock for 60s; each
// further failure re-arms the lock. In-memory is fine — single process,
// single user, and a restart just resets the counter.
let failures = 0;
let lockedUntil = 0;

function setSession(res: NextResponse, req: NextRequest, secret: string): void {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  res.cookies.set(SESSION_COOKIE, createSessionValue(secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: proto === "https", // plain-http LAN access still gets a cookie
    maxAge: SESSION_DAYS * 24 * 3600,
    path: "/",
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const password = typeof body.password === "string" ? body.password : "";
    const cfg = await getAuthConfig();

    // First run: no password exists yet — this request sets it. The site is
    // locked to this setup screen until then, so do it right after deploying.
    if (!cfg.passwordHash) {
      if (password.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
      }
      await setPassword(password);
      const res = NextResponse.json({ ok: true, setup: true });
      setSession(res, req, cfg.secret);
      return res;
    }

    if (Date.now() < lockedUntil) {
      return NextResponse.json(
        { error: `Too many attempts — try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s.` },
        { status: 429 },
      );
    }
    if (!password || !verifyPassword(password, cfg.passwordHash)) {
      failures++;
      if (failures >= 5) lockedUntil = Date.now() + 60_000;
      return NextResponse.json({ error: "Wrong password." }, { status: 401 });
    }

    failures = 0;
    lockedUntil = 0;
    const res = NextResponse.json({ ok: true });
    setSession(res, req, cfg.secret);
    return res;
  } catch (err) {
    console.error("login failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// Session check for the login page (are we in setup mode? already authed?).
export async function GET(req: NextRequest) {
  const cfg = await getAuthConfig();
  return NextResponse.json({
    setup: cfg.passwordHash === null,
    authed: cfg.passwordHash !== null && sessionValid(req.cookies.get(SESSION_COOKIE)?.value, cfg.secret),
  });
}
