"use client";

import { useParams } from "next/navigation";
import AuthorIpWorkbench from "../../../../../components/notes/author-ip/AuthorIpWorkbench";

export default function AuthorIpDetailPage() {
  const params = useParams();
  const ipId = String(params?.ipId || "");

  return <AuthorIpWorkbench ipId={ipId} />;
}
