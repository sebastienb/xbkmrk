import { NextResponse } from "next/server";
import { getFilterOptions } from "@/lib/queries";
import { maybeRequestSync } from "@/lib/access-sync";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // the reader fetches filters on every visit — treat that as "app opened"
    maybeRequestSync();
    return NextResponse.json(await getFilterOptions());
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
