import { Suspense } from "react";

export const metadata = {
  title: "创作 · Presto",
  description: "播客工作室与语音合成：输入主题或正文，生成播客或文本转语音"
};

export default function CreateLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl px-4 py-12 text-center text-sm text-muted">加载创作页…</div>
      }
    >
      {children}
    </Suspense>
  );
}
