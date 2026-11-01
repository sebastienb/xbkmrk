import AppHeader from "@/components/AppHeader";
import DigestIssueView from "@/components/DigestIssue";
import GenerateDigestButton from "@/components/GenerateDigestButton";
import { getDigestIssue } from "@/lib/digest";

export const dynamic = "force-dynamic";

export const metadata = { title: "The Weekly Bookmark" };

export default async function DigestPage() {
  const issue = await getDigestIssue();
  return (
    <>
      <AppHeader />
      {issue ? (
        <DigestIssueView issue={issue} />
      ) : (
        <div className="np-wrap np-empty">
          <h1>The Weekly Bookmark</h1>
          <p>No edition has been printed yet. A new one lands every Friday afternoon — or run the presses now.</p>
          <GenerateDigestButton />
        </div>
      )}
    </>
  );
}
