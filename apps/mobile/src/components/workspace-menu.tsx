import { DitherPressable } from "@/components/dither-pressable";
import { NativeText as Text } from "@/components/native-text";
import { router } from "expo-router";
import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { BottomDrawer } from "@/components/bottom-drawer";
import { BodyText } from "@/components/ui";
import { getWorkspaceId } from "@/lib/api/token-store";
import { getServer } from "@/lib/server";
import { signOut } from "@/lib/auth";
import { useNativeTheme } from "@/theme";

export function WorkspaceMenu({
  onClose,
  workspaces,
}: {
  onClose: () => void;
  workspaces: { id: string; name?: string | null }[];
}) {
  const theme = useNativeTheme();
  const { colors, spacing, typography, shape } = theme.manifest;
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const server = getServer();
  const activeWorkspace = workspaces.find((workspace) => workspace.id === getWorkspaceId());
  return (
    <BottomDrawer onDismiss={onClose} open title="Workspace">
      <View style={[styles.menu, { gap: spacing.extraSmall }]}>
        {workspaces.length > 1 ? (
          <DitherPressable
            radius={shape.medium}
            focusColor={colors.focus}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              router.push({
                pathname: "/onboarding/workspace",
                params: { mode: "switch" },
              });
            }}
            style={({ pressed }) => [
              styles.menuRow,
              { gap: spacing.extraSmall, paddingHorizontal: spacing.medium },
              pressed && { opacity: 0.5 },
            ]}
          >
            <Text style={[typography.bodyLarge, { color: colors.onSurface }]}>
              Switch workspace
            </Text>
            <BodyText>{activeWorkspace?.name ?? "Choose another workspace"}</BodyText>
          </DitherPressable>
        ) : null}
        <DitherPressable
          radius={shape.medium}
          focusColor={colors.focus}
          accessibilityRole="button"
          onPress={() => {
            onClose();
            router.push("/appearance");
          }}
          style={({ pressed }) => [
            styles.menuRow,
            { gap: spacing.extraSmall, paddingHorizontal: spacing.medium },
            pressed && { opacity: 0.5 },
          ]}
        >
          <Text style={[typography.bodyLarge, { color: colors.onSurface }]}>Appearance</Text>
          <BodyText>Theme and light or dark mode</BodyText>
        </DitherPressable>
        {server ? (
          <DitherPressable
            radius={shape.medium}
            focusColor={colors.focus}
            accessibilityRole="link"
            onPress={() => {
              onClose();
              void Linking.openURL(server.baseUrl);
            }}
            style={({ pressed }) => [
              styles.menuRow,
              { gap: spacing.extraSmall, paddingHorizontal: spacing.medium },
              pressed && { opacity: 0.5 },
            ]}
          >
            <Text style={[typography.bodyLarge, { color: colors.primary }]}>Open web app</Text>
            <BodyText>Manage accounts and settings</BodyText>
          </DitherPressable>
        ) : null}
        <DitherPressable
          radius={shape.medium}
          focusColor={colors.focus}
          accessibilityRole="button"
          accessibilityState={{ busy: signOutBusy, disabled: signOutBusy }}
          disabled={signOutBusy}
          onPress={() => {
            setSignOutBusy(true);
            setSignOutError(null);
            void signOut()
              .then((committed) => {
                if (!committed) {
                  setSignOutError("Your session changed. Try again.");
                  setSignOutBusy(false);
                  return;
                }
                onClose();
                router.replace("/");
              })
              .catch(() => {
                setSignOutError("Could not sign out. Try again.");
                setSignOutBusy(false);
              });
          }}
          style={({ pressed }) => [
            styles.menuRow,
            { gap: spacing.extraSmall, paddingHorizontal: spacing.medium },
            pressed && { opacity: 0.5 },
          ]}
        >
          <Text style={[typography.bodyLarge, { color: colors.error }]}>Sign out</Text>
        </DitherPressable>
        {signOutError ? (
          <BodyText accessibilityRole="alert" style={{ color: colors.error }}>
            {signOutError}
          </BodyText>
        ) : null}
      </View>
    </BottomDrawer>
  );
}

const styles = StyleSheet.create({
  menu: { width: "100%" },
  menuRow: { minHeight: 48, justifyContent: "center" },
});
