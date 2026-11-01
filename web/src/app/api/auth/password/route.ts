import { NextRequest, NextResponse } from "next/server";
import {
  createSessionValue, getAuthConfig, rotateSecret, setPassword, verifyPassword,
  SESSION_COOKIE, SESSION_DAYS,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

// Change password. Requires the current password even though the middleware
// already vouched for the session — a stolen device shouldn't be able to
// lock the owner out. Rotates the signing secret, which signs out every
// other device; this one gets a fresh cookie.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const current = typeof body.current === "string" ? body.current : "";
    const next = typeof body.next === "string" ? body.next : "";

    const cfg = await getAuthConfig();
    if (!cfg.passwordHash || !verifyPassword(current, cfg.passwordHash)) {
      return NextResponse.json({ error: "Current password is wrong." }, { status: 401 });
    }
    if (next.length < 8) {
      return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
    }

    await setPassword(next);
    const secret = await rotateSecret();

    const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, createSessionValue(secret), {
      httpOnly: true,
      sameSite: "lax",
      secure: proto === "https",
      maxAge: SESSION_DAYS * 24 * 3600,
      path: "/",
    });
    return res;
  } catch (err) {
    console.error("password change failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
