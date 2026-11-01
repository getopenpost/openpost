import { router } from "expo-router";
import { ScrollView } from "react-native";
import { Screen, Button } from "@/components/ui";
import { WorkspaceHeader } from "@/components/workspace-header";
import { useNativeTheme } from "@/theme";
export default function MoreScreen() {
  const { spacing } = useNativeTheme().manifest;
  return (
    <Screen>
      <WorkspaceHeader />
      <ScrollView contentContainerStyle={{ padding: spacing.large, gap: 12 }}>
        <Button
          title="Analytics"
          icon="analytics"
          intent="ordinary"
          onPress={() => router.push("/analytics")}
        />
        <Button
          title="Media"
          icon="gallery"
          intent="ordinary"
          onPress={() => router.push("/media")}
        />
        <Button
          title="Video Projects"
          icon="videoProjects"
          intent="ordinary"
          onPress={() => router.push("/projects")}
        />
        <Button
          title="Ideate"
          icon="sparkles"
          intent="ordinary"
          onPress={() => router.push("/ideate")}
        />
        <Button
          title="Appearance"
          icon="settings"
          intent="ordinary"
          onPress={() => router.push("/appearance")}
        />
        <Button
          title="Privacy"
          icon="account"
          intent="ordinary"
          onPress={() => router.push("/privacy")}
        />
      </ScrollView>
    </Screen>
  );
}
