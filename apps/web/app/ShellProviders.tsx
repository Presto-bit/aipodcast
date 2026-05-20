import Providers from "./providers";
import { resolveAuthSessionServer } from "../lib/authSession.server";
import { STATIC_SHELL_SESSION, type InitialAuthSession } from "../lib/authSession";

type ShellVariant = "static" | "server";

export default async function ShellProviders({
  children,
  variant
}: {
  children: React.ReactNode;
  variant: ShellVariant;
}) {
  let initialSession: InitialAuthSession;
  if (variant === "server") {
    initialSession = await resolveAuthSessionServer();
  } else {
    initialSession = STATIC_SHELL_SESSION;
  }
  return <Providers initialSession={initialSession}>{children}</Providers>;
}
