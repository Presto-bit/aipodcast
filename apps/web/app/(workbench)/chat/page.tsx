import HomePageClient from "../home/HomePageClient";
import {
  fetchHomeOverviewServer,
  getServerWorkbenchAuthHeaders
} from "../../../lib/workbenchServerPrefetch.server";

export default async function ChatPage() {
  const headers = await getServerWorkbenchAuthHeaders();
  const initialOverview = await fetchHomeOverviewServer(headers);
  return <HomePageClient initialOverview={initialOverview} />;
}
