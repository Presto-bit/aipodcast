import { marketingSiteUrl } from "../../lib/marketingSiteUrl";

type Props = {
  productLabel: string;
  className?: string;
};

/** PrestoAI | 产品名：PrestoAI 链到营销站，与 Shownotes 等页一致。 */
export function PrestoBrandHeading({ productLabel, className = "" }: Props) {
  const root = marketingSiteUrl();
  const headingClass = ["text-2xl font-semibold tracking-tight text-ink sm:text-3xl", className]
    .filter(Boolean)
    .join(" ");
  return (
    <h1 className={headingClass}>
      <a
        href={root}
        className="text-brand no-underline transition-colors hover:text-brand/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-sm"
      >
        PrestoAI
      </a>
      <span className="mx-2 select-none text-muted/45" aria-hidden>
        |
      </span>
      <span className="font-semibold text-ink/85">{productLabel}</span>
    </h1>
  );
}
