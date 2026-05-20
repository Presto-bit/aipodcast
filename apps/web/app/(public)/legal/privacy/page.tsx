import type { Metadata } from "next";
import { LegalDocPage } from "../../../components/legal/LegalDocPage";
import { PrivacyPolicyZh } from "../../../components/legal/PrivacyPolicyZh";

export const metadata: Metadata = {
  title: "隐私政策",
  description: "个人信息处理规则与权利说明"
};

export default function LegalPrivacyPage() {
  return (
    <LegalDocPage title="隐私政策" updatedLabel="最近更新：2026年4月24日 · 生效日期：2026年4月24日">
      <PrivacyPolicyZh />
    </LegalDocPage>
  );
}
