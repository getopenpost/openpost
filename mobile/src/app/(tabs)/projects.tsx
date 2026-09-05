import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  BodyText,
  Button,
  Card,
  ContentTitle,
  EmptyState,
  PageTitle,
  Screen,
} from "@/components/ui";
import { getWorkspaceId } from "@/lib/api/token-store";
import { errorHaptic, successHaptic } from "@/lib/haptics";
import {
  listMobileVideoProjects,
  pendingVideoCaptureCount,
  queueVideoCapture,
  syncPendingVideoCaptures,
  type MobileVideoProject,
} from "@/lib/video-projects";
import { useNativeTheme } from "@/theme";

export default function VideoProjectsScreen() {
  const theme = useNativeTheme();
  const { colors, spacing, typography } = theme.manifest;
  const [projects, setProjects] = useState<MobileVideoProject[]>([]);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const workspaceId = getWorkspaceId();

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const [nextProjects, queued] = await Promise.all([
        listMobileVideoProjects(workspaceId),
        pendingVideoCaptureCount(workspaceId),
      ]);
      setProjects(nextProjects);
      setPending(queued);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Video Projects");
    } finally {
      setBusy(false);
    }
  }, [workspaceId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function chooseVideo(source: "camera" | "library") {
    if (!workspaceId || busy) return;
    setBusy(true);
    try {
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ["videos"],
              videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["videos"],
              allowsMultipleSelection: false,
            });
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset) return;
      await queueVideoCapture(workspaceId, asset, {
        source_range: { start_seconds: 0, end_seconds: Math.max(0, (asset.duration ?? 0) / 1000) },
        crop: { x: 0, y: 0, width: 1, height: 1 },
        rotation: 0,
        gain: 1,
        muted: false,
        cover_frame_seconds: 0,
      });
      setPending(await pendingVideoCaptureCount(workspaceId));
      setMessage("Saved on this device. Upload it now or keep working offline.");
      void successHaptic();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this video");
      void errorHaptic();
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    if (!workspaceId || busy) return;
    setBusy(true);
    try {
      const count = await syncPendingVideoCaptures(workspaceId);
      setMessage(
        count > 0 ? `${count} capture${count === 1 ? "" : "s"} uploaded.` : "Everything is synced.",
      );
      void successHaptic();
      await refresh();
    } catch (error) {
      setPending(await pendingVideoCaptureCount(workspaceId));
      setMessage(
        error instanceof Error
          ? error.message
          : "Upload paused. Your capture is safe on this device.",
      );
      void errorHaptic();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ gap: spacing.large, paddingBottom: spacing.extraLarge }}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} />}
      >
        <View style={{ gap: spacing.extraSmall }}>
          <PageTitle>Video Projects</PageTitle>
          <BodyText>Capture or import footage here, then finish the edit on the web.</BodyText>
        </View>
        <Card style={{ gap: spacing.medium }}>
          <ContentTitle>Prepare footage</ContentTitle>
          <BodyText>
            Original files stay unchanged. Trim, crop, rotation, audio, and cover choices travel
            with the project.
          </BodyText>
          <View style={styles.actions}>
            <Button
              title="Record video"
              onPress={() => void chooseVideo("camera")}
              disabled={busy}
            />
            <Button
              title="Choose from library"
              intent="ordinary"
              onPress={() => void chooseVideo("library")}
              disabled={busy}
            />
          </View>
          {pending > 0 ? (
            <Button
              title={`Upload ${pending} pending`}
              onPress={() => void syncNow()}
              loading={busy}
            />
          ) : null}
        </Card>
        {message ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.bodyMedium, { color: colors.onSurfaceVariant }]}
          >
            {message}
          </Text>
        ) : null}
        {projects.length === 0 ? (
          <EmptyState title="No cloud projects yet" body="Record or import a video to start one." />
        ) : (
          <View style={{ gap: spacing.small }}>
            {projects.map((project) => (
              <Card key={project.id} style={{ gap: spacing.extraSmall }}>
                <ContentTitle>{project.name}</ContentTitle>
                <BodyText>
                  {project.sync_status === "needs_attention"
                    ? project.attention_reason || "Needs attention"
                    : project.sync_status.replace("_", " ")}
                </BodyText>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
});
