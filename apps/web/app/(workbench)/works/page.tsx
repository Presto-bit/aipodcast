import WorksPageClient from "./WorksPageClient";
import {
  fetchWorksPageServer,
  getServerWorkbenchAuthHeaders
} from "../../../lib/workbenchServerPrefetch.server";

const WORKS_LIMIT = 60;

export default async function WorksPage() {
  const headers = await getServerWorkbenchAuthHeaders();
  const initialWorks = await fetchWorksPageServer(headers, WORKS_LIMIT, 0);
  return <WorksPageClient initialWorks={initialWorks} />;
}
