export function IconShareClipboard({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeLinejoin="round" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeLinejoin="round" />
    </svg>
  );
}

export function IconShareCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconShareExport({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="m8 7 4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconDownloadBundle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="m8 11 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 21h16" strokeLinecap="round" />
    </svg>
  );
}
