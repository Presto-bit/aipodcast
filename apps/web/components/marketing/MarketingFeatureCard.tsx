import Image from "next/image";
import type { ReactNode } from "react";

type Props = {
  title: string;
  body: ReactNode;
  imageSrc: string;
  imageAlt: string;
  /** 大屏下图在左、文在右 */
  reverse?: boolean;
};

/** 营销「核心能力」：左文右图，大屏可左右交替。 */
export default function MarketingFeatureCard({ title, body, imageSrc, imageAlt, reverse = false }: Props) {
  return (
    <article className="grid gap-6 lg:grid-cols-[2fr_3fr] lg:items-center lg:gap-8">
      <div className={`min-w-0 ${reverse ? "lg:order-2" : "lg:order-1"}`}>
        <h3 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">{title}</h3>
        <p className="mt-3 text-sm leading-relaxed text-muted sm:text-[15px]">{body}</p>
      </div>
      <div className={`min-w-0 ${reverse ? "lg:order-1" : "lg:order-2"}`}>
        <Image
          src={imageSrc}
          alt={imageAlt}
          width={1376}
          height={768}
          loading="lazy"
          sizes="(max-width: 1024px) 100vw, 480px"
          className="h-auto w-full rounded-2xl border border-line/80 bg-surface/50 shadow-soft"
        />
      </div>
    </article>
  );
}
