import ShownotesMakeClient from "../../../../../../components/shownotes/ShownotesMakeClient";

type PageProps = { params: Promise<{ projectId: string }> };

export default async function PodcastShownotesMakeProjectPage({ params }: PageProps) {
  const { projectId } = await params;
  return <ShownotesMakeClient projectId={projectId} />;
}
