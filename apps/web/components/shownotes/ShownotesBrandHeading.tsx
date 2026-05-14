import { marketingSiteUrl } from "../../lib/marketingSiteUrl";

export function ShownotesBrandHeading({ className = "" }: { className?: string }) {
  const root = marketingSiteUrl();
  const headingClass = ["text-2xl font-semibold tracking-tight text-ink sm:text-3xl", className].filter(Boolean).join(" ");
  return (
    <h1 className={headingClass}>
      <a href={root} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-brand hover:underline">
        PrestoAI
      </a>
      <span className="mx-1.5 font-light text-muted">|</span>
      <span className="text-ink">Shownotes</span>
    </h1>
  );
}
