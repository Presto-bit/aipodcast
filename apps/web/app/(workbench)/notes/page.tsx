import NotesHubPage from "../../../components/notes/NotesHubPage";
import {
  fetchNotebooksHubServer,
  getServerWorkbenchAuthHeaders
} from "../../../lib/workbenchServerPrefetch.server";

export default async function NotesPage() {
  const headers = await getServerWorkbenchAuthHeaders();
  const initialHub = await fetchNotebooksHubServer(headers);
  return <NotesHubPage initialHub={initialHub} />;
}
