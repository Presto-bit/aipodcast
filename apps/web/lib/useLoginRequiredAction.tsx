"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import LoginRequiredToast from "../components/ui/LoginRequiredToast";
import { rememberPostAuthReturnTo } from "./authReturnTo";
import { rememberPostAuthAction } from "./authPostAction";

export function useLoginRequiredAction(loggedIn: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [featureLabel, setFeatureLabel] = useState("");
  const [open, setOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState("");

  const currentPath = useMemo(() => {
    const qs = searchParams?.toString() || "";
    const hash = typeof window === "undefined" ? "" : window.location.hash || "";
    return `${pathname || "/"}${qs ? `?${qs}` : ""}${hash}`;
  }, [pathname, searchParams]);

  const promptLogin = useCallback(
    (feature: string, actionKey?: string): false => {
      if (loggedIn) return false;
      setFeatureLabel(feature);
      setPendingAction(String(actionKey || "").trim());
      setOpen(true);
      return false;
    },
    [loggedIn]
  );

  const ensureLoggedInForAction = useCallback(
    (feature: string, actionKey?: string): boolean => {
      if (loggedIn) return true;
      promptLogin(feature, actionKey);
      return false;
    },
    [loggedIn, promptLogin]
  );

  const goLogin = useCallback(() => {
    rememberPostAuthReturnTo(currentPath);
    if (pendingAction) rememberPostAuthAction(window.location.pathname, pendingAction);
    setOpen(false);
    setPendingAction("");
    router.push(`/me/profile?returnTo=${encodeURIComponent(currentPath)}`);
  }, [currentPath, pendingAction, router]);

  const loginPromptNode = (
    <LoginRequiredToast
      open={open}
      featureLabel={featureLabel}
      onClose={() => {
        setOpen(false);
        setPendingAction("");
      }}
      onGoLogin={goLogin}
    />
  );

  return { ensureLoggedInForAction, loginPromptNode };
}
