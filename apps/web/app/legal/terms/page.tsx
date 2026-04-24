import type { Metadata } from "next";
import { LegalDocPage } from "../../../components/legal/LegalDocPage";
import { UserAgreementZh } from "../../../components/legal/UserAgreementZh";

export const metadata: Metadata = {
  title: "用户协议",
  description: "服务使用条款与行为规范"
};

export default function LegalTermsPage() {
  return (
    <LegalDocPage title="用户协议" updatedLabel="最近更新：2026年4月24日 · 生效日期：2026年4月24日">
      <UserAgreementZh />
    </LegalDocPage>
  );
}
