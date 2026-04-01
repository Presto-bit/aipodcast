type Props = {
  title?: string;
  subtitle?: string;
};

export function PricingHero({ title, subtitle }: Props) {
  return (
    <header className="text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        {title ?? "升级订阅方案"}
      </h1>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
        {subtitle ??
          "为播客与语音创作选对档位：按月或按年灵活付费，额度与权益与后台权限矩阵一致。"}
      </p>
    </header>
  );
}
