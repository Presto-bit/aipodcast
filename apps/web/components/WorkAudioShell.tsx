"use client";

import { WorkAudioPlayerProvider } from "../lib/workAudioPlayer";

/** 仅工作台路由需要全局作品试听；营销页不挂载以减轻首屏 JS 与状态开销。 */
export default function WorkAudioShell({ children }: { children: React.ReactNode }) {
  return <WorkAudioPlayerProvider>{children}</WorkAudioPlayerProvider>;
}
