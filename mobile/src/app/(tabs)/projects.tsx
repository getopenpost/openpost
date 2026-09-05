import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import {
  BodyText,
  Button,
  Card,
  ContentTitle,
  EmptyState,
  PageTitle,
  Screen,
  TextField,
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
  const [selectedAsset, setSelectedAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [trimStart, setTrimStart] = useState("0");
  const [trimEnd, setTrimEnd] = useState("0");
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [crop, setCrop] = useState<"full" | "square" | "vertical">("full");
  const [muted, setMuted] = useState(false);
  const [gain, setGain] = useState("1");
  const [coverFrame, setCoverFrame] = useState("0");
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
      setSelectedAsset(asset);
      setTrimStart("0");
      setTrimEnd(String(Math.max(0, (asset.duration ?? 0) / 1000)));
      setRotation(0);
      setCrop("full");
      setMuted(false);
      setGain("1");
      setCoverFrame("0");
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open this video");
      void errorHaptic();
    } finally {
      setBusy(false);
    }
  }

  async function savePreparedVideo() {
    if (!workspaceId || !selectedAsset || busy) return;
    const start = Number(trimStart);
    const end = Number(trimEnd);
    const audioGain = Number(gain);
    const cover = Number(coverFrame);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      setMessage("Choose a trim end after the trim start.");
      return;
    }
    if (!Number.isFinite(audioGain) || audioGain < 0 || audioGain > 2) {
      setMessage("Volume must be between 0 and 2.");
      return;
    }
    if (!Number.isFinite(cover) || cover < start || cover > end) {
      setMessage("Cover frame must be inside the selected trim range.");
      return;
    }
    setBusy(true);
    try {
      const cropRecipe = cropForMode(selectedAsset, crop);
      await queueVideoCapture(workspaceId, selectedAsset, {
        source_range: { start_seconds: start, end_seconds: end },
        crop: cropRecipe,
        rotation,
        gain: audioGain,
        muted,
        cover_frame_seconds: cover,
      });
      setSelectedAsset(null);
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
          {selectedAsset ? (
            <View style={{ gap: spacing.medium }}>
              <ContentTitle>{selectedAsset.fileName || "Selected video"}</ContentTitle>
              <View style={styles.actions}>
                <View style={styles.field}>
                  <BodyText>Trim start, seconds</BodyText>
                  <TextField
                    value={trimStart}
                    onChangeText={setTrimStart}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Trim start in seconds"
                  />
                </View>
                <View style={styles.field}>
                  <BodyText>Trim end, seconds</BodyText>
                  <TextField
                    value={trimEnd}
                    onChangeText={setTrimEnd}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Trim end in seconds"
                  />
                </View>
              </View>
              <BodyText>Crop</BodyText>
              <View style={styles.actions}>
                {(["full", "square", "vertical"] as const).map((value) => (
                  <Button
                    key={value}
                    title={value === "full" ? "Full frame" : value}
                    intent={crop === value ? "primary" : "ordinary"}
                    onPress={() => setCrop(value)}
                  />
                ))}
              </View>
              <BodyText>Rotation</BodyText>
              <View style={styles.actions}>
                {([0, 90, 180, 270] as const).map((value) => (
                  <Button
                    key={value}
                    title={`${value}°`}
                    intent={rotation === value ? "primary" : "ordinary"}
                    onPress={() => setRotation(value)}
                  />
                ))}
              </View>
              <View style={styles.actions}>
                <View style={styles.field}>
                  <BodyText>Volume, 0 to 2</BodyText>
                  <TextField
                    value={gain}
                    onChangeText={setGain}
                    keyboardType="decimal-pad"
                    editable={!muted}
                    accessibilityLabel="Audio volume"
                  />
                </View>
                <View style={styles.switchRow}>
                  <BodyText>Mute audio</BodyText>
                  <Switch value={muted} onValueChange={setMuted} accessibilityLabel="Mute audio" />
                </View>
                <View style={styles.field}>
                  <BodyText>Cover frame, seconds</BodyText>
                  <TextField
                    value={coverFrame}
                    onChangeText={setCoverFrame}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Cover frame in seconds"
                  />
                </View>
              </View>
              <Button
                title="Save prepared footage"
                onPress={() => void savePreparedVideo()}
                loading={busy}
              />
            </View>
          ) : null}
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

function cropForMode(asset: ImagePicker.ImagePickerAsset, mode: "full" | "square" | "vertical") {
  if (mode === "full" || asset.width <= 0 || asset.height <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const sourceRatio = asset.width / asset.height;
  const targetRatio = mode === "square" ? 1 : 9 / 16;
  if (sourceRatio > targetRatio) {
    const width = targetRatio / sourceRatio;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = sourceRatio / targetRatio;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  field: { flex: 1, minWidth: 140, gap: 6 },
  switchRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 },
});
