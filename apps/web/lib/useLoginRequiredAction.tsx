"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { rememberPostAuthReturnTo } from "./authReturnTo";
import { rememberPostAuthAction } from "./authPostAction";

export function useLoginRequiredAction(loggedIn: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentPath = useMemo(() => {
    const qs = searchParams?.toString() || "";
    const hash = typeof window === "undefined" ? "" : window.location.hash || "";
    return `${pathname || "/"}${qs ? `?${qs}` : ""}${hash}`;
  }, [pathname, searchParams]);

  const redirectToLogin = useCallback(
    (actionKey?: string) => {
      rememberPostAuthReturnTo(currentPath);
      const key = String(actionKey || "").trim();
      if (key) rememberPostAuthAction(window.location.pathname, key);
      router.push(`/register?returnTo=${encodeURIComponent(currentPath)}`);
    },
    [currentPath, router]
  );

  const ensureLoggedInForAction = useCallback(
    (_feature: string, actionKey?: string): boolean => {
      if (loggedIn) return true;
      redirectToLogin(actionKey);
      return false;
    },
    [loggedIn, redirectToLogin]
  );

  return { ensureLoggedInForAction, loginPromptNode: null };
}
