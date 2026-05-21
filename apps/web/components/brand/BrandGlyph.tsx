import Image from "next/image";

type Props = { className?: string; size?: number };

/** 品牌图形：设计稿涂鸦字标，用于侧栏、顶栏与空态。 */
export default function BrandGlyph({ className = "", size = 48 }: Props) {
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-dawn-lg bg-[#ebe3f3] shadow-soft ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label="PrestoAI"
    >
      <Image
        src="/brand/prestoai-wordmark.png"
        alt=""
        width={512}
        height={160}
        className="h-[78%] w-[90%] object-contain"
        aria-hidden
      />
    </div>
  );
}
