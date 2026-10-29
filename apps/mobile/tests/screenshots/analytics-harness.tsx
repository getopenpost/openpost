// Layout preview of the shipping Analytics screen, with the screenshot API fixtures.
// Start screenshot Metro with OPENPOST_ANALYTICS_PREVIEW=1; open /analytics?analytics_capture=1.
import { registerRootComponent } from "expo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AnalyticsScreen from "../../src/app/(tabs)/analytics";
import { NativeThemeRuntime } from "../../src/theme";
import { loadServer } from "../../src/lib/server";
import { loadToken, loadWorkspaceId } from "../../src/lib/api/token-store";
const client = new QueryClient();
function App() {
  return (
    <QueryClientProvider client={client}>
      <NativeThemeRuntime workspaceId="mobile-review">
        <SafeAreaProvider>
          <AnalyticsScreen />
        </SafeAreaProvider>
      </NativeThemeRuntime>
    </QueryClientProvider>
  );
}
Promise.all([loadServer(), loadToken(), loadWorkspaceId()]).then(() => registerRootComponent(App));
