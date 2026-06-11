import { redirect } from "next/navigation";
import { WORKBENCH_PODCAST_VOICE_PATH } from "../../../lib/navPaths";

type PageProps = { searchParams: Promise<{ tab?: string }> };

/** 旧路径兼容：重定向至播客子路由 */
export default async function VoiceRedirectPage({ searchParams }: PageProps) {
  const { tab } = await searchParams;
  const qs = tab ? `?tab=${encodeURIComponent(tab)}` : "";
  redirect(`${WORKBENCH_PODCAST_VOICE_PATH}${qs}`);
}
