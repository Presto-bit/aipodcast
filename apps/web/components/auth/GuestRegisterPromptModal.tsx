"use client";

import SmallConfirmModal from "../ui/SmallConfirmModal";
import { newUserExperienceTagline, registerQuickStartLine } from "../../lib/newUserExperience";

type Props = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** 访客点击「开始生成」等需登录能力前的注册引导。 */
export default function GuestRegisterPromptModal({ open, onCancel, onConfirm }: Props) {
  return (
    <SmallConfirmModal
      open={open}
      title="注册后即可继续创作"
      message={`注册后可保存作品、上传自己的资料并生成播客。${newUserExperienceTagline()}。${registerQuickStartLine()}`}
      confirmLabel="去注册"
      cancelLabel="稍后再说"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
