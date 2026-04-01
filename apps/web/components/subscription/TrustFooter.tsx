type Props = {
  supportEmail?: string;
};

export function TrustFooter({ supportEmail }: Props) {
  const mail = supportEmail?.trim();
  return (
    <footer className="mt-10 flex flex-col items-center gap-3 border-t border-line pt-8 text-center text-sm text-muted">
      <div className="flex flex-wrap items-center justify-center gap-4">
        <span>支付宝 / 微信（以实际上线为准）</span>
        <span className="hidden sm:inline">·</span>
        <span>订阅可随时在周期结束后调整</span>
      </div>
      <p className="text-xs">
        企业或团队定制需求？
        {mail ? (
          <a href={`mailto:${mail}`} className="ml-1 text-brand hover:underline">
            联系我们
          </a>
        ) : (
          <span className="text-ink/80"> 请联系运营或管理员</span>
        )}
      </p>
    </footer>
  );
}
