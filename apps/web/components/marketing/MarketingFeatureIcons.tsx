import type { SVGProps } from "react";

const STROKE = 1.75;

/** 营销「核心能力」卡片图标，线宽与 NavIcons 接近 */
export function IconFeatureSources(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M8 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" strokeLinejoin="round" />
      <path d="M6 8h2M6 12h2M6 16h2" strokeLinecap="round" />
      <path d="M12 8h5M12 12h4M12 16h5" strokeLinecap="round" />
    </svg>
  );
}

export function IconFeatureCitation(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M7 7.5c0-1.5 1.2-2.5 2.5-2.5 1.8 0 3 1.4 3 3.2 0 2.2-1.6 3.8-3.5 4.8V14" strokeLinecap="round" />
      <path d="M13 7.5c0-1.5 1.2-2.5 2.5-2.5 1.8 0 3 1.4 3 3.2 0 2.2-1.6 3.8-3.5 4.8V14" strokeLinecap="round" />
      <path d="M5 18h14" strokeLinecap="round" />
    </svg>
  );
}

export function IconFeatureFormats(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <rect x="3" y="5" width="8" height="10" rx="1.5" strokeLinejoin="round" />
      <rect x="13" y="9" width="8" height="10" rx="1.5" strokeLinejoin="round" />
      <path d="M11 10h2M11 13h2" strokeLinecap="round" />
    </svg>
  );
}

export function IconFeaturePodcast(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M9 10V8a3 3 0 1 1 6 0v2" strokeLinejoin="round" />
      <path d="M8 14a4 4 0 0 0 8 0" strokeLinecap="round" />
      <path d="M12 18v3" strokeLinecap="round" />
      <path d="M9.5 21h5" strokeLinecap="round" />
      <path d="M5 11v1.5c0 1.8 1.4 3.2 3.2 3.5" strokeLinecap="round" />
      <path d="M19 11v1.5c0 1.8-1.4 3.2-3.2 3.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconTrustGift(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M12 8v13M12 8H7.5a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8zm0 0h4.5a2.5 2.5 0 0 0 0-5C14 3 12 8 12 8z" strokeLinejoin="round" />
      <path d="M5 12h14v9H5z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconTrustQuote(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M4 14h4v6H4zM16 14h4v6h-4z" strokeLinejoin="round" />
      <path d="M6 10V8a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2M18 10V8a2 2 0 0 0-2-2h0a2 2 0 0 0-2 2v2" strokeLinecap="round" />
    </svg>
  );
}

export function IconTrustWallet(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M4 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" strokeLinejoin="round" />
      <path d="M16 13h2" strokeLinecap="round" />
      <path d="M2 11h4" strokeLinecap="round" />
    </svg>
  );
}
