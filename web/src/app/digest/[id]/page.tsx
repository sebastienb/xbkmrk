import { notFound } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import DigestIssueView from "@/components/DigestIssue";
import { getDigestIssue } from "@/lib/digest";

export const dynamic = "force-dynamic";

export const metadata = { title: "The Weekly Bookmark" };

export default async function DigestIssuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const issue = await getDigestIssue(parseInt(id, 10));
  if (!issue) notFound();
  return (
    <>
      <AppHeader />
      <DigestIssueView issue={issue} />
    </>
  );
}
