import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { router, Stack } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useShareIntentContext } from "expo-share-intent";

import { DitherPanel } from "@/components/dither-panel";
import { WorkspaceHeader } from "@/components/workspace-header";
import { PublicationRow } from "@/components/publication-row";
import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";
import {
  BodyText,
  Button,
  ContentTitle,
  EmptyState,
  IconButton,
  Screen,
  TextField,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { relativeTime } from "@/lib/format";
import { errorHaptic, selectionHaptic, successHaptic } from "@/lib/haptics";
import { MAX_ATTACHMENT_BYTES, type PendingAttachment } from "@/lib/media";
import { stashPendingAttachments, stashSharedFiles } from "@/lib/share";
import { cacheCreatedPublication, invalidatePublicationData } from "@/lib/query-cache";
import { queryKeys } from "@/lib/query-policy";
import {
  currentWorkspaceId,
  prefetchPublicationEditor,
  usePublications,
  useWorkspaces,
} from "@/lib/queries";
import { getWorkspaceId } from "@/lib/api/token-store";
import {
  captureWorkspaceQueryScope,
  queryActorScopeIsCurrent,
  requireCurrentQuerySession,
  workspaceQueryScopeIsCurrent,
  type WorkspaceQueryScope,
} from "@/lib/query-session";
import { useNativeTheme } from "@/theme";

type CreateDraftRequest = {
  scope: WorkspaceQueryScope;
  text: string;
};

export default function DraftsScreen() {
  const { fontScale } = useWindowDimensions();
  const theme = useNativeTheme();
  const { colors, shape, spacing, typography } = theme.manifest;
  const queryClient = useQueryClient();
  const [idea, setIdea] = useState("");
  const [image, setImage] = useState<PendingAttachment | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const ideaInputRef = useRef<TextInput | null>(null);
  const drafts = usePublications("draft");
  const workspaces = useWorkspaces();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const handledShare = useRef(false);

  const createDraft = useMutation({
    onMutate: ({ scope }: CreateDraftRequest) =>
      queryClient.cancelQueries({
        queryKey: queryKeys.publicationActivity(scope.workspaceId, "draft"),
        exact: true,
      }),
    mutationFn: async ({ scope, text }: CreateDraftRequest) => {
      requireCurrentQuerySession(scope);
      const { data, error, response } = await api().POST("/publications", {
        body: {
          workspace_id: scope.workspaceId,
          creation_preset: "post",
          content_profile: "short_text",
          title: "",
          source_text: text,
        },
      });
      if (error || !data) throw new Error(await errorMessage(response, "Could not save draft"));
      return { publication: data, scope };
    },
    onSuccess: async ({ publication, scope }) => {
      if (!queryActorScopeIsCurrent(scope)) return;
      await queryClient.cancelQueries({
        queryKey: queryKeys.publicationActivity(scope.workspaceId, "draft"),
        exact: true,
      });
      if (!queryActorScopeIsCurrent(scope)) return;
      cacheCreatedPublication(queryClient, scope.workspaceId, publication);
      void invalidatePublicationData(queryClient, {
        workspaceId: scope.workspaceId,
        activities: ["draft"],
      });
    },
    onError: (_, { scope }) => {
      if (!queryActorScopeIsCurrent(scope)) return;
      void invalidatePublicationData(queryClient, {
        workspaceId: scope.workspaceId,
        activities: ["draft"],
      });
    },
  });

  async function quickCapture(buildWithAI = false) {
    const text = idea.trim();
    if (!text && !image) return;
    const scope = captureWorkspaceQueryScope(currentWorkspaceId());
    setCaptureError(null);
    try {
      const { publication: draft } = await createDraft.mutateAsync({
        scope,
        text,
      });
      if (!workspaceQueryScopeIsCurrent(scope, getWorkspaceId())) return;
      stashPendingAttachments(image ? [image] : []);
      setIdea("");
      setImage(null);
      void successHaptic();
      void prefetchPublicationEditor(queryClient, scope.workspaceId, draft.id);
      router.push({
        pathname: "/publications/[id]/edit",
        params: {
          id: draft.id,
          celebrate: "1",
          ...(buildWithAI ? { build: "1" } : {}),
        },
      });
    } catch (err) {
      if (!workspaceQueryScopeIsCurrent(scope, getWorkspaceId())) return;
      setCaptureError(err instanceof Error ? err.message : "Could not save draft");
      void errorHaptic();
    }
  }

  async function pickImage(source: "library" | "camera" = "library") {
    try {
      if (source === "camera" && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
        setCaptureError("Allow camera access in Settings to take a photo.");
        return;
      }
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ["images"],
              quality: 0.9,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              allowsMultipleSelection: false,
              quality: 0.9,
            });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      const capturedAt = Date.now();
      applyImage(
        {
          localId: `local-${capturedAt}`,
          uri: asset.uri,
          mimeType: asset.mimeType ?? "image/jpeg",
          filename: asset.fileName ?? `photo-${capturedAt}.jpg`,
          size: asset.fileSize ?? null,
        },
        () => ideaInputRef.current?.focus(),
      );
    } catch {
      setCaptureError(
        source === "camera"
          ? "Could not open the camera. Try again."
          : "Could not open your photo library. Try again.",
      );
      void errorHaptic();
    }
  }

  function applyImage(nextImage: PendingAttachment, focus?: () => void) {
    if (nextImage.size !== null && nextImage.size > MAX_ATTACHMENT_BYTES) {
      setCaptureError("Images must be 50 MB or smaller.");
      void errorHaptic();
      focus?.();
      return;
    }

    const commit = () => {
      setImage(nextImage);
      setCaptureError(null);
      void selectionHaptic();
    };

    if (!image) {
      commit();
      focus?.();
      return;
    }

    Alert.alert(
      "Replace image?",
      "Your current image will be removed.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Replace", style: "destructive", onPress: commit },
      ],
      { onDismiss: focus },
    );
  }

  useEffect(() => {
    if (!hasShareIntent || handledShare.current) return;
    if (!workspaces.data?.[0]?.id) return;
    handledShare.current = true;

    const parts = [shareIntent.text?.trim(), shareIntent.webUrl?.trim()].filter(Boolean);
    const sharedText = parts.join("\n\n");
    const files = shareIntent.files ?? [];
    if (files.length > 0) stashSharedFiles(files);

    resetShareIntent();
    void (async () => {
      const scope = captureWorkspaceQueryScope(currentWorkspaceId());
      try {
        const { publication: draft } = await createDraft.mutateAsync({
          scope,
          text: sharedText,
        });
        if (!workspaceQueryScopeIsCurrent(scope, getWorkspaceId())) return;
        void successHaptic();
        void prefetchPublicationEditor(queryClient, scope.workspaceId, draft.id);
        router.push({
          pathname: "/publications/[id]/edit",
          params: { id: draft.id, celebrate: "1" },
        });
      } catch {
        if (!workspaceQueryScopeIsCurrent(scope, getWorkspaceId())) return;
        setCaptureError("Could not create a draft from the shared content");
        void errorHaptic();
      }
    })();
  }, [hasShareIntent, shareIntent, resetShareIntent, workspaces.data, createDraft, queryClient]);

  const list = drafts.data ?? [];
  const hasDraftData = drafts.data !== undefined;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <WorkspaceHeader />

      <ScrollView
        contentContainerStyle={{
          gap: spacing.large,
          paddingHorizontal: spacing.large,
          paddingTop: spacing.small,
          paddingBottom: spacing.large,
        }}
        refreshControl={
          <RefreshControl
            refreshing={drafts.isRefetching}
            onRefresh={() => void drafts.refetch()}
            tintColor={colors.onSurfaceVariant}
          />
        }
      >
        <DitherPanel>
          <TextField
            ref={ideaInputRef}
            value={idea}
            onChangeText={setIdea}
            accessibilityLabel="Draft idea"
            placeholder="What are you building?"
            multiline
            textAlignVertical="top"
            imageKeyboard={{
              onImageReceived: (attachment, context) => applyImage(attachment, context.focus),
              onError: (message, context) => {
                setCaptureError(message);
                void errorHaptic();
                context.focus();
              },
            }}
            style={[
              styles.ideaField,
              typography.bodyLarge,
              { backgroundColor: "transparent", borderColor: "transparent" },
            ]}
          />
          {image ? (
            <View
              style={[
                styles.attachmentRow,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.outlineVariant,
                  borderRadius: shape.medium,
                  gap: spacing.medium,
                  padding: spacing.small,
                },
              ]}
            >
              <Image
                source={{ uri: image.uri }}
                style={[styles.attachmentThumb, { borderRadius: shape.small }]}
                contentFit="cover"
              />
              <BodyText numberOfLines={1} style={{ color: colors.onSurface, flex: 1 }}>
                {image.filename}
              </BodyText>
              <IconButton
                label={`Remove ${image.filename}`}
                role="delete"
                color={colors.error}
                onPress={() => setImage(null)}
              />
            </View>
          ) : null}
          <View
            style={[
              styles.captureActions,
              {
                gap: spacing.small,
                flexDirection: fontScale >= 1.3 ? "column" : "row",
                flexWrap: "nowrap",
              },
            ]}
          >
            <Button
              icon="gallery"
              title={image ? "Replace image" : "Add image"}
              intent="ordinary"
              disabled={createDraft.isPending}
              onPress={() => void pickImage()}
              style={{
                flex: fontScale >= 1.3 ? 0 : 1,
                width: fontScale >= 1.3 ? "100%" : undefined,
              }}
            />
            <Button
              title="Camera"
              icon="camera"
              intent="ordinary"
              disabled={createDraft.isPending}
              onPress={() => void pickImage("camera")}
              style={{
                flex: fontScale >= 1.3 ? 0 : 1,
                width: fontScale >= 1.3 ? "100%" : undefined,
              }}
            />
          </View>
          {captureError ? (
            <BodyText accessibilityRole="alert" style={{ color: colors.error, marginTop: 6 }}>
              {captureError}
            </BodyText>
          ) : null}
          <View
            style={[
              styles.captureActions,
              {
                gap: spacing.small,
                flexDirection: fontScale >= 1.3 ? "column" : "row",
                flexWrap: "nowrap",
              },
            ]}
          >
            <Button
              title="Generate draft"
              icon="sparkles"
              intent="focal"
              onPress={() => void quickCapture(true)}
              disabled={createDraft.isPending || idea.trim().length === 0}
              loading={createDraft.isPending}
              style={{ flex: 1, minWidth: 120 }}
            />
            <Button
              title="Write post"
              intent="ordinary"
              style={{ flex: 1, minWidth: 120 }}
              onPress={() => void quickCapture(false)}
              disabled={createDraft.isPending || (idea.trim().length === 0 && !image)}
            />
          </View>
        </DitherPanel>

        <ContentTitle>Recent drafts</ContentTitle>
        <DelayedQueryPlaceholder
          pending={!hasDraftData && drafts.isPending}
          shape="list"
          offline={drafts.fetchStatus === "paused"}
        />
        {drafts.isError && !hasDraftData ? (
          <InitialQueryError
            title="Could not load drafts"
            message={
              drafts.error instanceof Error
                ? drafts.error.message
                : "Check your connection and try again."
            }
            retry={() => void drafts.refetch()}
          />
        ) : null}
        {drafts.isError && hasDraftData ? (
          <QueryNotice
            message="Could not refresh drafts. The current list remains visible."
            retry={() => void drafts.refetch()}
          />
        ) : null}
        {hasDraftData && drafts.fetchStatus === "paused" ? (
          <QueryNotice message="You are offline. Current drafts remain visible." offline />
        ) : null}
        {list.length === 0 && hasDraftData ? <EmptyState title="No drafts yet" /> : null}
        <View>
          {list.map((draft) => (
            <PublicationRow
              key={draft.id}
              publication={draft}
              detail={`Edited ${relativeTime(draft.updated_at)}`}
              onPress={() => {
                const workspaceId = currentWorkspaceId();
                void prefetchPublicationEditor(queryClient, workspaceId, draft.id);
                router.push({
                  pathname: "/publications/[id]/edit",
                  params: { id: draft.id },
                });
              }}
            />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  ideaField: {
    minHeight: 80,
    paddingHorizontal: 0,
    paddingTop: 10,
  },
  attachmentRow: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 80,
  },
  attachmentThumb: {
    height: 64,
    width: 64,
  },
  captureActions: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
  },
});
