import { QueryClient } from "@tanstack/react-query";
import { openPostQueryDefaults } from "@openpost/query-catalog";

import { subscribeServer } from "./server";
import { subscribeToken, subscribeWorkspaceId } from "./api/token-store";
import { markQueryActorChanged, markQuerySessionChanged } from "./query-session";

export const queryClient = new QueryClient({
  defaultOptions: openPostQueryDefaults,
});

function clearQuerySession(): void {
  markQueryActorChanged();
  queryClient.clear();
}

subscribeServer(clearQuerySession);
subscribeToken(clearQuerySession);
subscribeWorkspaceId(markQuerySessionChanged);
