"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

export type ChangePasswordModalProps = {
  open: boolean;
  onClose: () => void;
  /** 成功后由父级展示页内提示等 */
  onSuccess: () => void;
  /**
   * 提交新密码；失败时抛出 Error(message)，成功时 resolve。
   */
  applyChange: (currentPassword: string, newPassword: string) => Promise<void>;
};

/**
 * 居中弹窗内完成修改密码（当前密码 + 新密码 + 确认），挂到 document.body 避免被裁切。
 */
export default function ChangePasswordModal({ open, onClose, onSuccess, applyChange }: ChangePasswordModalProps) {
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState("");
  const [nextPw, setNextPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setCurrent("");
    setNextPw("");
    setConfirmPw("");
    setErr("");
    setBusy(false);
    const id = requestAnimationFrame(() => {
      currentPasswordRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const handleClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) handleClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, handleClose]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (nextPw !== confirmPw) {
      setErr("两次输入的新密码不一致");
      return;
    }
    if (nextPw.length < 6) {
      setErr("新密码至少 6 位");
      return;
    }
    setBusy(true);
    try {
      await applyChange(current, nextPw);
      onSuccess();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fym-workspace-scrim z-[1200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-password-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-surface/50 backdrop-blur-[1px]"
        aria-label="关闭"
        disabled={busy}
        onClick={handleClose}
      />
      <form
        className="fym-modal-card relative z-[1] w-full max-w-md space-y-3 p-5"
        onSubmit={(e) => void onSubmit(e)}
      >
        <h2 id="change-password-modal-title" className="text-sm font-semibold text-ink">
          修改密码
        </h2>
        <p className="text-[11px] leading-relaxed text-muted">修改成功后请使用新密码登录。</p>
        <input
          ref={currentPasswordRef}
          className="fym-control w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
          type="password"
          placeholder="当前密码"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          minLength={1}
          maxLength={120}
          autoComplete="current-password"
          aria-label="当前密码"
        />
        <input
          className="fym-control w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
          type="password"
          placeholder="新密码（至少 6 位）"
          value={nextPw}
          onChange={(e) => setNextPw(e.target.value)}
          required
          minLength={6}
          maxLength={128}
          autoComplete="new-password"
          aria-label="新密码"
        />
        <input
          className="fym-control w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
          type="password"
          placeholder="确认新密码"
          value={confirmPw}
          onChange={(e) => setConfirmPw(e.target.value)}
          required
          minLength={6}
          maxLength={128}
          autoComplete="new-password"
          aria-label="确认新密码"
        />
        {err ? (
          <p className="rounded-md border border-danger/30 bg-danger-soft px-2 py-1.5 text-[11px] text-danger-ink" role="alert">
            {err}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" disabled={busy} className="px-3 py-1.5 text-xs" onClick={handleClose}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={busy} className="px-3 py-1.5 text-xs disabled:opacity-50">
            {busy ? "保存中…" : "更新密码"}
          </Button>
        </div>
      </form>
    </div>,
    document.body
  );
}
