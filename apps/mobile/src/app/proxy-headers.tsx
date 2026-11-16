import { Stack, Redirect, useRouter } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import { ScrollView } from "react-native";
import { BodyText, Button, Screen, useColors } from "@/components/ui";
import { ProxyHeadersEditor } from "@/components/proxy-headers-editor";
import { getServer, subscribeServer, updateServerHeaders } from "@/lib/server";
import { validateServerHeaders } from "@/lib/server-headers";
import { useLaunchSession } from "@/lib/launch-session";

export default function ProxyHeadersScreen() {
  const server = useSyncExternalStore(subscribeServer, getServer);
  const [editingServer] = useState(() => server?.baseUrl);
  const [headers, setHeaders] = useState(() => server?.headers ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colors = useColors();
  const router = useRouter();
  const launch = useLaunchSession();
  if (!server || server.isHosted || server.baseUrl !== editingServer) return <Redirect href="/" />;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateServerHeaders(validateServerHeaders(headers));
      launch.reload();
      router.replace("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save proxy headers. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen safeTop={false}>
      <Stack.Screen
        options={{
          title: "Proxy headers",
          headerShown: true,
          headerBackTitle: "Back",
        }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 16 }}
      >
        <BodyText>{server.baseUrl}</BodyText>
        <ProxyHeadersEditor headers={headers} onChange={setHeaders} disabled={busy} expanded />
        {error ? (
          <BodyText accessibilityRole="alert" style={{ color: colors.error }}>
            {error}
          </BodyText>
        ) : null}
        <Button title="Save headers" onPress={() => void save()} loading={busy} />
      </ScrollView>
    </Screen>
  );
}
