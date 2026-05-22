import type { SVGProps } from "react";
import { iconSvgProps, type IconProps } from "../Icon";

function ActionIcon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return <svg {...iconSvgProps(props)}>{children}</svg>;
}

export function IconClipboard(props: IconProps) {
  return (
    <ActionIcon {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeLinejoin="round" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeLinejoin="round" />
    </ActionIcon>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <ActionIcon {...props}>
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </ActionIcon>
  );
}

export function IconShareExport(props: IconProps) {
  return (
    <ActionIcon {...props}>
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="m8 7 4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" strokeLinecap="round" strokeLinejoin="round" />
    </ActionIcon>
  );
}

export function IconDownloadBundle(props: IconProps) {
  return (
    <ActionIcon {...props}>
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="m8 11 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 21h16" strokeLinecap="round" />
    </ActionIcon>
  );
}

/** @deprecated 使用 IconClipboard */
export const IconShareClipboard = IconClipboard;

/** @deprecated 使用 IconCheck */
export const IconShareCheck = IconCheck;

export type { SVGProps };
