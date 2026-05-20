import { Suspense } from "react";
import RegisterView from "./RegisterView";

function RegisterFallback() {
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <p className="text-sm text-muted">加载中…</p>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<RegisterFallback />}>
      <RegisterView />
    </Suspense>
  );
}
