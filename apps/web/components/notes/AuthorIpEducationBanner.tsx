"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "presto_author_ip_edu_dismissed_v1";

export default function AuthorIpEducationBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(!localStorage.getItem(STORAGE_KEY));
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  return (
    <div className="mb-6 rounded-xl border border-brand/25 bg-brand/5 p-4 text-sm text-ink">
      <p className="font-medium">知识库 vs 个人特色 IP</p>
      <p className="mt-1 text-muted">
        <strong className="font-normal text-ink">参考资料</strong>（/notes）存放事实与引用；{" "}
        <strong className="font-normal text-ink">个人特色 IP</strong> 蒸馏你的经历与口吻，写作时勾选「按我的风格」即可成文。
      </p>
      <button
        type="button"
        className="mt-3 text-xs text-brand hover:underline"
        onClick={() => {
          try {
            localStorage.setItem(STORAGE_KEY, "1");
          } catch {
            /* ignore */
          }
          setVisible(false);
        }}
      >
        知道了
      </button>
    </div>
  );
}
