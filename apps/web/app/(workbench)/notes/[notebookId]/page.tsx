"use client";

import { useParams } from "next/navigation";
import NotesPageMain from "../../../../components/notes/NotesPageMainDynamic";

export default function NotesNotebookPage() {
  const params = useParams();
  const notebookId = String(params?.notebookId || "").trim();
  return <NotesPageMain initialNotebookId={notebookId || null} />;
}
