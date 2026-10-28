// Isolated sample-data entry for inspecting the shared native chooser.
// Run through Metro on a device or React Native Web, never the shipping entry.
import { registerRootComponent } from "expo";
import { useState } from "react";
import { Platform, ScrollView } from "react-native";
import { DestinationChooser } from "../../src/components/destination-chooser";
import { NativeThemeRuntime, useNativeTheme } from "../../src/theme";

const platforms = ["bluesky", "instagram", "linkedin", "threads", "mastodon", "facebook"];
const accounts = Array.from({ length: 18 }, (_, index) => ({
  id: `account-${index}`,
  platform: platforms[index % platforms.length],
  account_username: `studio_${index + 1}`,
  alias:
    index === 0
      ? "Studio with a long account name that must remain readable"
      : `Studio ${index + 1}`,
}));
const sets = Array.from({ length: 8 }, (_, index) => ({
  id: `set-${index}`,
  name: `Social Set ${index + 1}`,
  is_default: index === 0,
  accounts: accounts.slice(index, index + 4).map((account) => ({ social_account_id: account.id })),
}));
function Chooser() {
  const mode =
    Platform.OS === "web" ? new URLSearchParams(window.location.search).get("state") : null;
  const [selected, setSelected] = useState(["account-0", "account-2", "disconnected"]);
  const [setId, setSetId] = useState("");
  const theme = useNativeTheme();
  const query = <T,>(data: T) => ({
    data: mode === "loading" ? undefined : data,
    isPending: mode === "loading",
    isError: mode === "error",
    fetchStatus: mode === "offline" ? ("paused" as const) : ("idle" as const),
    refetch() {},
  });
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.manifest.colors.background }}
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <DestinationChooser
        accounts={query(mode === "empty" ? [] : accounts)}
        socialSets={query(mode === "empty" ? [] : sets)}
        selectedIds={mode === "empty" ? [] : selected}
        activeSetId={setId}
        renditions={[{ social_account_id: "disconnected", platform: "x" }]}
        onApplySet={(id, ids) => {
          setSetId(id);
          setSelected(ids);
        }}
        onToggle={(id) =>
          setSelected((current) =>
            current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
          )
        }
        onConfirm={() => {}}
      />
    </ScrollView>
  );
}
function App() {
  return (
    <NativeThemeRuntime workspaceId={null}>
      <Chooser />
    </NativeThemeRuntime>
  );
}
registerRootComponent(App);
