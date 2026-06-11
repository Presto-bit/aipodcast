import { redirect } from "next/navigation";
import { WORKBENCH_PODCAST_CLIP_PATH } from "../../../lib/navPaths";

/** 旧路径兼容：重定向至播客子路由 */
export default function ClipRedirectPage() {
  redirect(WORKBENCH_PODCAST_CLIP_PATH);
}
