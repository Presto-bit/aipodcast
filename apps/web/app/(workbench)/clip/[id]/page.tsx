import { redirect } from "next/navigation";
import { WORKBENCH_PODCAST_CLIP_PATH } from "../../../../lib/navPaths";

type PageProps = { params: Promise<{ id: string }> };

/** 旧路径兼容：重定向至播客子路由 */
export default async function ClipProjectRedirectPage({ params }: PageProps) {
  const { id } = await params;
  redirect(`${WORKBENCH_PODCAST_CLIP_PATH}/${encodeURIComponent(id)}`);
}
