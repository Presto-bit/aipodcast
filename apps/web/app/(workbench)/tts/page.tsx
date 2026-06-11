import { redirect } from "next/navigation";
import { WORKBENCH_TTS_STUDIO_PATH } from "../../../lib/navPaths";

/** 旧路径兼容：重定向至播客子路由 */
export default function TtsRedirectPage() {
  redirect(WORKBENCH_TTS_STUDIO_PATH);
}
