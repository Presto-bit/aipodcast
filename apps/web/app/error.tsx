"use client";

import { useEffect, useMemo } from "react";
import { Button } from "../components/ui/Button";
import { classifyErrorTone, errorPageCopy } from "../lib/errorCopy";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const { headline, sub } = useMemo(() => errorPageCopy(classifyErrorTone(error.message)), [error.message]);
  const digest = error.digest;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-fill px-6 text-ink">
      <h1 className="text-lg font-semibold">{headline}</h1>
      <p className="max-w-md text-center text-sm text-muted">{sub}</p>
      {error.message ? (
        <p className="max-w-md break-words rounded-dawn-md border border-line bg-surface px-3 py-2 text-center font-mono text-xs text-muted">
          {error.message}
        </p>
      ) : null}
      {digest ? (
        <p className="text-center text-[11px] text-muted">
          错误编号 <span className="font-mono text-ink">{digest}</span>（反馈给管理员时可附上）
        </p>
      ) : null}
      <Button type="button" variant="primary" onClick={() => reset()}>
        重试
      </Button>
    </div>
  );
}
