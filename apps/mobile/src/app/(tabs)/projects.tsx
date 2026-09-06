import * as ImagePicker from "expo-image-picker";
import * as Network from "expo-network";
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type CameraType,
  type VideoQuality,
} from "expo-camera";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
  getAllowCellularVideoUploads,
  setAllowCellularVideoUploads,
} from "@/lib/video-project-upload-preferences";
import {
  listMobileVideoProjects,
  pendingVideoCaptureCount,
  queueVideoCapture,
  syncPendingVideoCaptures,
  type MobileVideoProject,
  type VideoCaptureAsset,
} from "@/lib/video-projects";
import { useNativeTheme } from "@/theme";

export default function VideoProjectsScreen() {
  const theme = useNativeTheme();
  const { colors, spacing, typography } = theme.manifest;
  const [projects, setProjects] = useState<MobileVideoProject[]>([]);
  const [pending, setPending] = useState(0);
  const [allowCellularUploads, setAllowCellularUploads] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<VideoCaptureAsset | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const camera = useRef<CameraView>(null);
  const recordingStartedAt = useRef(0);
  const pausedAt = useRef(0);
  const pausedDuration = useRef(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<CameraType>("back");
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("1080p");
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [pauseSupported, setPauseSupported] = useState(false);
  const resumeInFlight = useRef(false);
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
      void getAllowCellularVideoUploads().then(setAllowCellularUploads);
    }, [refresh]),
  );

  const resumePendingUploads = useCallback(
    async (networkState?: Network.NetworkState) => {
      if (!workspaceId || resumeInFlight.current) return;
      resumeInFlight.current = true;
      try {
        const count = await syncPendingVideoCaptures(workspaceId, networkState);
        if (count > 0) await refresh();
      } catch {
        // Offline and Wi-Fi policy pauses are expected. The queue stays durable.
      } finally {
        resumeInFlight.current = false;
      }
    },
    [refresh, workspaceId],
  );

  useEffect(() => {
    const initialResume = setTimeout(() => void resumePendingUploads(), 0);
    const subscription = Network.addNetworkStateListener((state) => {
      void resumePendingUploads(state);
    });
    return () => {
      clearTimeout(initialResume);
      subscription.remove();
    };
  }, [allowCellularUploads, resumePendingUploads]);

  async function changeCellularUploadPolicy(value: boolean) {
    setAllowCellularUploads(value);
    try {
      await setAllowCellularVideoUploads(value);
      if (value) void resumePendingUploads();
    } catch (error) {
      setAllowCellularUploads(!value);
      setMessage(error instanceof Error ? error.message : "Could not save upload preference");
    }
  }

  async function chooseVideo() {
    if (!workspaceId || busy) return;
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
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

  async function openCamera() {
    if (busy) return;
    const cameraAccess = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission();
    if (!cameraAccess.granted) {
      setMessage("Camera access is required to record video.");
      return;
    }
    if (microphoneEnabled && !microphonePermission?.granted) {
      const microphoneAccess = await requestMicrophonePermission();
      if (!microphoneAccess.granted) setMicrophoneEnabled(false);
    }
    setCameraOpen(true);
    setMessage(null);
  }

  async function startRecording() {
    if (!camera.current || !cameraReady || recording) return;
    recordingStartedAt.current = Date.now();
    pausedAt.current = 0;
    pausedDuration.current = 0;
    setRecording(true);
    setRecordingPaused(false);
    try {
      const result = await camera.current.recordAsync();
      if (!result) return;
      const endedAt = Date.now();
      const paused = pausedAt.current > 0 ? endedAt - pausedAt.current : 0;
      const durationMs = Math.max(
        1_000,
        endedAt - recordingStartedAt.current - pausedDuration.current - paused,
      );
      const size = videoDimensions(videoQuality);
      setSelectedAsset({
        uri: result.uri,
        fileName: `recording-${recordingStartedAt.current}.mp4`,
        mimeType: "video/mp4",
        duration: durationMs,
        width: size.width,
        height: size.height,
      });
      setTrimStart("0");
      setTrimEnd(String(durationMs / 1_000));
      setRotation(0);
      setCrop("full");
      setMuted(!microphoneEnabled);
      setGain("1");
      setCoverFrame("0");
      setCameraOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not record video");
      void errorHaptic();
    } finally {
      setRecording(false);
      setRecordingPaused(false);
    }
  }

  function stopRecording() {
    camera.current?.stopRecording();
  }

  async function toggleRecordingPause() {
    if (!camera.current || !recording || !pauseSupported) return;
    const now = Date.now();
    await camera.current.toggleRecordingAsync();
    if (recordingPaused) {
      pausedDuration.current += now - pausedAt.current;
      pausedAt.current = 0;
    } else {
      pausedAt.current = now;
    }
    setRecordingPaused(!recordingPaused);
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
            <Button title="Record video" onPress={() => void openCamera()} disabled={busy} />
            <Button
              title="Choose from library"
              intent="ordinary"
              onPress={() => void chooseVideo()}
              disabled={busy}
            />
          </View>
          {cameraOpen ? (
            <View style={{ gap: spacing.medium }}>
              <View style={styles.cameraFrame}>
                <CameraView
                  ref={camera}
                  style={StyleSheet.absoluteFill}
                  mode="video"
                  facing={cameraFacing}
                  mute={!microphoneEnabled}
                  videoQuality={videoQuality}
                  onCameraReady={() => {
                    setCameraReady(true);
                    setPauseSupported(
                      camera.current?.getSupportedFeatures().toggleRecordingAsyncAvailable ?? false,
                    );
                  }}
                  onMountError={(event) => setMessage(event.message)}
                />
              </View>
              <View style={styles.actions}>
                <Button
                  title={cameraFacing === "back" ? "Use front camera" : "Use back camera"}
                  intent="ordinary"
                  onPress={() => setCameraFacing(cameraFacing === "back" ? "front" : "back")}
                  disabled={recording}
                />
                <Button
                  title={microphoneEnabled ? "Microphone on" : "Microphone off"}
                  intent={microphoneEnabled ? "primary" : "ordinary"}
                  onPress={() => setMicrophoneEnabled(!microphoneEnabled)}
                  disabled={recording}
                />
              </View>
              <BodyText>Recording quality</BodyText>
              <View style={styles.actions}>
                {(["720p", "1080p", "2160p"] as const).map((quality) => (
                  <Button
                    key={quality}
                    title={quality}
                    intent={videoQuality === quality ? "primary" : "ordinary"}
                    onPress={() => setVideoQuality(quality)}
                    disabled={recording}
                  />
                ))}
              </View>
              <View style={styles.actions}>
                {recording ? (
                  <>
                    {pauseSupported ? (
                      <Button
                        title={recordingPaused ? "Resume" : "Pause"}
                        intent="ordinary"
                        onPress={() => void toggleRecordingPause()}
                      />
                    ) : null}
                    <Button title="Stop recording" onPress={stopRecording} />
                  </>
                ) : (
                  <>
                    <Button
                      title="Start recording"
                      onPress={() => void startRecording()}
                      disabled={!cameraReady}
                    />
                    <Button title="Cancel" intent="ordinary" onPress={() => setCameraOpen(false)} />
                  </>
                )}
              </View>
            </View>
          ) : null}
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
          <View style={styles.switchRow}>
            <BodyText>Upload large videos over cellular</BodyText>
            <Switch
              value={allowCellularUploads}
              onValueChange={(value) => void changeCellularUploadPolicy(value)}
              accessibilityLabel="Upload large videos over cellular"
            />
          </View>
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
  cameraFrame: { aspectRatio: 16 / 9, overflow: "hidden", borderRadius: 12 },
  field: { flex: 1, minWidth: 140, gap: 6 },
  switchRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 },
});

function videoDimensions(quality: VideoQuality): { width: number; height: number } {
  switch (quality) {
    case "2160p":
      return { width: 3840, height: 2160 };
    case "720p":
      return { width: 1280, height: 720 };
    case "480p":
      return { width: 854, height: 480 };
    case "4:3":
      return { width: 640, height: 480 };
    default:
      return { width: 1920, height: 1080 };
  }
}
