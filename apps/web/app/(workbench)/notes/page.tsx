"use client";

import dynamic from "next/dynamic";

const NotesPageMain = dynamic(() => import("../../../components/notes/NotesPageMain"), {
  ssr: false
});

export default function NotesPage() {
  return <NotesPageMain />;
}
