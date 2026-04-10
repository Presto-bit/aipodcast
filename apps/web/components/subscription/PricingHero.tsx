type Props = {
  title?: string;
  subtitle?: string;
};

export function PricingHero({ title, subtitle }: Props) {
  return (
    <header className="text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        {title ?? "订阅方案"}
      </h1>
      {subtitle ? (
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted">{subtitle}</p>
      ) : null}
    </header>
  );
}
