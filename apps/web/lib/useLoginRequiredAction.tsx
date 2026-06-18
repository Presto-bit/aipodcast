"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import GuestRegisterPromptModal from "../components/auth/GuestRegisterPromptModal";
import { trackFunnelEvent } from "./funnelAnalytics";
import { rememberPostAuthReturnTo } from "./authReturnTo";
import { rememberPostAuthAction } from "./authPostAction";

type EnsureOptions = {
  /** 访客先弹层说明注册价值，确认后再跳转注册页 */
  prompt?: boolean;
};

export function useLoginRequiredAction(loggedIn: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [registerPromptOpen, setRegisterPromptOpen] = useState(false);
  const [pendingActionKey, setPendingActionKey] = useState<string | undefined>();

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
    (_feature: string, actionKey?: string, options?: EnsureOptions): boolean => {
      if (loggedIn) return true;
      if (options?.prompt) {
        void trackFunnelEvent("guest_generate_click", { meta: { action: String(actionKey || "") } });
        setPendingActionKey(actionKey);
        setRegisterPromptOpen(true);
        return false;
      }
      redirectToLogin(actionKey);
      return false;
    },
    [loggedIn, redirectToLogin]
  );

  const loginPromptNode = (
    <GuestRegisterPromptModal
      open={registerPromptOpen}
      onCancel={() => setRegisterPromptOpen(false)}
      onConfirm={() => {
        setRegisterPromptOpen(false);
        void trackFunnelEvent("guest_generate_register_confirm", {
          meta: { action: String(pendingActionKey || "") }
        });
        redirectToLogin(pendingActionKey);
      }}
    />
  );

  return { ensureLoggedInForAction, loginPromptNode };
}
