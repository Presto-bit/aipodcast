import HomePageClient from "./HomePageClient";
import {
  fetchHomeOverviewServer,
  getServerWorkbenchAuthHeaders
} from "../../../lib/workbenchServerPrefetch.server";

export default async function HomePage() {
  const headers = await getServerWorkbenchAuthHeaders();
  const initialOverview = await fetchHomeOverviewServer(headers);
  return <HomePageClient initialOverview={initialOverview} />;
}
