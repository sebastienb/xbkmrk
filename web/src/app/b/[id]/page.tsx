import { Suspense } from "react";
import ReadingView from "@/components/ReadingView";

export default async function BookmarkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Suspense: ReadingView reads ?q= (search-hit highlighting) via useSearchParams
  return (
    <Suspense>
      <ReadingView id={id} />
    </Suspense>
  );
}
