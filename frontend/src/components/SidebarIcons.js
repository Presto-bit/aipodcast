import React from 'react';

const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export function IconHome(props) {
  return (
    <svg {...iconProps} {...props}>
      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5z" />
    </svg>
  );
}

export function IconPodcast(props) {
  return (
    <svg {...iconProps} {...props}>
      <path d="M12 3a6 6 0 0 0-6 6v5a3 3 0 0 0 6 0V9" />
      <path d="M12 3v6" />
      <path d="M8 21h8" />
      <path d="M12 16v5" />
      <circle cx="17" cy="6" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconTts(props) {
  return (
    <svg {...iconProps} {...props}>
      <path d="M4 6h16v12H4z" />
      <path d="M8 10h8M8 14h5" />
      <path d="M12 18v3M10 21h4" />
    </svg>
  );
}

export function IconVoiceClone(props) {
  return (
    <svg {...iconProps} {...props}>
      <path d="M12 3a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
      <path d="M8 21h8" />
      <path d="M12 16v5" />
      <path d="M17 8l3 2v4l-3 2" />
    </svg>
  );
}

export function IconNotes(props) {
  return (
    <svg {...iconProps} {...props}>
      <path d="M8 4h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M8 8h10M8 12h10M8 16h6" />
    </svg>
  );
}

/** 笔记 → 播客（文档 + 麦克风） */
export function IconNotesPodcast(props) {
  return (
    <svg {...iconProps} {...props}>
      <path d="M6 4h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M6 9h8M6 13h5" />
      <path d="M17 8a3 3 0 0 1 3 3v1a3 3 0 0 1-6 0v-1a3 3 0 0 1 3-3z" />
      <path d="M17 15v3" />
    </svg>
  );
}

export function IconDrafts(props) {
  return (
    <svg {...iconProps} {...props}>
      <path d="M7 3h8l4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M15 3v5h5" />
      <path d="M8 13h8M8 17h6" />
    </svg>
  );
}

export function IconWorks(props) {
  return (
    <svg {...iconProps} {...props}>
      <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" />
      <path d="M8 5v2M16 5v2" />
      <path d="M4 11h16" />
      <path d="M8 15h4" />
    </svg>
  );
}

export function IconVoiceCatalog(props) {
  return (
    <svg {...iconProps} {...props}>
      <path d="M4 18V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12" />
      <path d="M4 14h4v4H4zM10 12h4v6h-4zM16 8h4v10h-4z" />
    </svg>
  );
}

export function IconSettings(props) {
  return (
    <svg {...iconProps} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

export function IconApi(props) {
  return (
    <svg {...iconProps} {...props}>
      <path d="M3 10h3l2-4h8l2 4h3" />
      <circle cx="7" cy="16" r="2" />
      <circle cx="17" cy="16" r="2" />
      <path d="M9 16h6" />
    </svg>
  );
}

export function IconSubscription(props) {
  return (
    <svg {...iconProps} {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </svg>
  );
}

export function IconUser(props) {
  return (
    <svg {...iconProps} {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

export function IconChevronLeft(props) {
  return (
    <svg {...iconProps} width={18} height={18} {...props}>
      <path d="M14 6l-6 6 6 6" />
    </svg>
  );
}

export function IconChevronRight(props) {
  return (
    <svg {...iconProps} width={18} height={18} {...props}>
      <path d="M10 6l6 6-6 6" />
    </svg>
  );
}
