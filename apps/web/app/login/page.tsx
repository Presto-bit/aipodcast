import { Suspense } from "react";
import LoginView from "./LoginView";

function LoginFallback() {
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <p className="text-sm text-muted">加载中…</p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginView />
    </Suspense>
  );
}
