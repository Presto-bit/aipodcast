"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { WORKBENCH_STUDIO_PATH } from "../../../lib/navPaths";
import { createStudioWork, findDraftStudioWork } from "../../../lib/studioWorkStorage";

/** 侧栏「创作」直达任务页；已有空任务则进入该任务，不重复新建 */
export default function StudioPage() {
  const router = useRouter();

  useEffect(() => {
    const draft = findDraftStudioWork();
    if (draft) {
      router.replace(`${WORKBENCH_STUDIO_PATH}/${draft.id}`);
      return;
    }
    const w = createStudioWork();
    router.replace(`${WORKBENCH_STUDIO_PATH}/${w.id}`);
  }, [router]);

  return (
    <main className="flex min-h-[40vh] items-center justify-center text-sm text-muted">
      进入创作…
    </main>
  );
}
