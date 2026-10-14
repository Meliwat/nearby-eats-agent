import { Suspense } from "react";
import { GroupPollPage } from "@/components/group-poll";

// The poll id comes from the URL, so this page renders per request inside a Suspense boundary.
export default function Page() {
  return (
    <Suspense fallback={<p className="p-6 text-center text-sm text-stone-500">Loading the poll…</p>}>
      <GroupPollPage />
    </Suspense>
  );
}
