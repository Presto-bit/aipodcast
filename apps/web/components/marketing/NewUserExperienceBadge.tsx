import { newUserExperienceTagline } from "../../lib/newUserExperience";

type Props = {
  className?: string;
};

/** 营销页 / 注册页：新用户体验包说明 */
export default function NewUserExperienceBadge({ className = "" }: Props) {
  return (
    <p
      className={[
        "inline-flex max-w-full items-center rounded-full border border-brand/25 bg-brand/8 px-3 py-1 text-xs font-medium leading-snug text-ink",
        className
      ].join(" ")}
    >
      {newUserExperienceTagline()}
    </p>
  );
}
