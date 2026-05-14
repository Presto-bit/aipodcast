import { marketingSiteUrl } from "../../lib/marketingSiteUrl";

export function ShownotesBrandHeading({ className = "" }: { className?: string }) {
  const root = marketingSiteUrl();
  const headingClass = ["text-2xl font-semibold tracking-tight text-ink sm:text-3xl", className].filter(Boolean).join(" ");
  return (
    <h1 className={headingClass}>
      <a
        href={root}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand no-underline transition-colors hover:text-brand/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-sm"
      >
        PrestoAI
      </a>
      <span className="mx-2 select-none text-muted/45" aria-hidden>
        |
      </span>
      <span className="font-semibold text-ink/85">Shownotes</span>
    </h1>
  );
}
