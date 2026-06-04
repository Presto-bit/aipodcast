import { Suspense } from "react";
import WorksTrashPageClient from "../../../../components/works/WorksTrashPageClient";

export default function WorksTrashPage() {
  return (
    <Suspense fallback={null}>
      <WorksTrashPageClient />
    </Suspense>
  );
}
