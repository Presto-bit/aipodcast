import StudioWorkEditor from "../../../../components/studio-work/StudioWorkEditor";

export default async function StudioWorkPage({
  params
}: {
  params: Promise<{ workId: string }>;
}) {
  const { workId } = await params;
  return <StudioWorkEditor workId={workId} />;
}
