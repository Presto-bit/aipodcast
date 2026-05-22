import Image from "next/image";
import type { ReactNode } from "react";

type Props = {
  title: string;
  body: ReactNode;
  imageSrc: string;
  imageAlt: string;
};

/** 营销「核心能力」：小屏上文下图；大屏左文约 30%、右图约 70%。 */
export default function MarketingFeatureCard({ title, body, imageSrc, imageAlt }: Props) {
  return (
    <article className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_7fr] lg:items-center lg:gap-8">
      <div className="min-w-0">
        <h3 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">{title}</h3>
        <p className="mt-3 text-sm leading-relaxed text-muted sm:text-[15px]">{body}</p>
      </div>
      <div className="min-w-0">
        <Image
          src={imageSrc}
          alt={imageAlt}
          width={1376}
          height={768}
          loading="lazy"
          sizes="(max-width: 1024px) 100vw, 700px"
          className="h-auto w-full rounded-2xl border border-line/80 bg-surface/50 shadow-soft"
        />
      </div>
    </article>
  );
}
