import { redirect } from "next/navigation";
import { WORKBENCH_DEFAULT_PATH } from "../../../lib/navPaths";

type Props = {
  searchParams?: Record<string, string | string[] | undefined>;
};

/** 旧路径：/chat → 资料工作台 */
export default function ChatRedirectPage({ searchParams }: Props) {
  const qs = new URLSearchParams();
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        for (const v of value) qs.append(key, v);
      } else {
        qs.set(key, value);
      }
    }
  }
  const q = qs.toString();
  redirect(q ? `${WORKBENCH_DEFAULT_PATH}?${q}` : WORKBENCH_DEFAULT_PATH);
}
