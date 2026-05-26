import { redirect } from "next/navigation";

type Props = { params: { ipId: string } };

export default function AuthorIpTraitsRedirect({ params }: Props) {
  redirect(`/notes/author-ip/${params.ipId}`);
}
