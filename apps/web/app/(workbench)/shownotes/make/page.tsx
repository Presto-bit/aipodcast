import { redirect } from "next/navigation";
import { WORKBENCH_PODCAST_SHOWNOTES_PATH } from "../../../../lib/navPaths";

/** 旧路径兼容：重定向至播客子路由 */
export default function ShownotesMakeRedirectPage() {
  redirect(`${WORKBENCH_PODCAST_SHOWNOTES_PATH}/make`);
}
