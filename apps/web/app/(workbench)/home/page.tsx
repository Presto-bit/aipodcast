import { redirect } from "next/navigation";

type Props = {
  searchParams?: Record<string, string | string[] | undefined>;
};

/** 旧路径：/home → /chat（保留 query） */
export default function HomeRedirectPage({ searchParams }: Props) {
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
  redirect(q ? `/chat?${q}` : "/chat");
}
