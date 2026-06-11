import { redirect } from "next/navigation";
import { WORKBENCH_DEFAULT_PATH } from "../../../lib/navPaths";

/** 写作 Studio 已下线：/studio → 资料工作台 */
export default function StudioRedirectPage() {
  redirect(WORKBENCH_DEFAULT_PATH);
}
