import { redirect } from "next/navigation";

type Props = { params: { ipId: string } };

export default function AuthorIpMaterialsRedirect({ params }: Props) {
  redirect(`/notes/author-ip/${params.ipId}`);
}
