import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { router, Stack } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ProtectedIcon } from "@/components/protected-icon";
import { useShareIntentContext } from "expo-share-intent";

import { BottomDrawer } from "@/components/bottom-drawer";
import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";
import {
  BodyText,
  Button,
  Card,
  ContentTitle,
  EmptyState,
  IconButton,
  PageTitle,
  Screen,
  TextField,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { relativeTime } from "@/lib/format";
import { errorHaptic, selectionHaptic, successHaptic } from "@/lib/haptics";
import type { PendingAttachment } from "@/lib/media";
import { stashPendingAttachments, stashSharedFiles } from "@/lib/share";
import { cacheCreatedPublication, invalidatePublicationData } from "@/lib/query-cache";
import { queryKeys } from "@/lib/query-policy";
import {
  currentWorkspaceId,
  prefetchPublicationEditor,
  usePublications,
  useWorkspaces,
  type PublicationListItem,
} from "@/lib/queries";
import { getWorkspaceId } from "@/lib/api/token-store";
import {
  captureWorkspaceQueryScope,
  queryActorScopeIsCurrent,
  requireCurrentQuerySession,
  workspaceQueryScopeIsCurrent,
  type WorkspaceQueryScope,
} from "@/lib/query-session";
import { getServer } from "@/lib/server";
import { signOut } from "@/lib/auth";
import { useNativeTheme } from "@/theme";

type CreateDraftRequest = {
  scope: WorkspaceQueryScope;
  text: string;
};

export default function DraftsScreen() {
  const theme = useNativeTheme();
  const { colors, shape, spacing, typography } = theme.manifest;
  const queryClient = useQueryClient();
  const [idea, setIdea] = useState("");
  const [image, setImage] = useState<PendingAttachment | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const drafts = usePublications("draft");
  const workspaces = useWorkspaces();
  const [menuOpen, setMenuOpen] = useState(false);
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
      const { publication: draft } = await createDraft.mutateAsync({ scope, text });
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

  async function pickImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 0.9,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      const capturedAt = Date.now();
      setImage({
        localId: `local-${capturedAt}`,
        uri: asset.uri,
        mimeType: asset.mimeType ?? "image/jpeg",
        filename: asset.fileName ?? `photo-${capturedAt}.jpg`,
        size: asset.fileSize ?? null,
      });
      setCaptureError(null);
      void selectionHaptic();
    } catch {
      setCaptureError("Could not open your photo library. Try again.");
      void errorHaptic();
    }
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
        const { publication: draft } = await createDraft.mutateAsync({ scope, text: sharedText });
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
  const activeWorkspace = workspaces.data?.find((workspace) => workspace.id === getWorkspaceId());

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          styles.header,
          {
            gap: spacing.medium,
            paddingBottom: spacing.small,
            paddingHorizontal: spacing.extraLarge,
            paddingTop: spacing.large,
          },
        ]}
      >
        <View style={{ flex: 1 }}>
          <PageTitle>Drafts</PageTitle>
          {workspaces.data && workspaces.data.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Switch workspace"
              onPress={() => setMenuOpen(true)}
            >
              <BodyText>{activeWorkspace?.name ?? "Choose workspace"}</BodyText>
            </Pressable>
          ) : null}
        </View>
        <MenuButton onOpen={() => setMenuOpen(true)} />
      </View>

      <View
        style={[
          styles.capture,
          {
            backgroundColor: colors.surface,
            borderColor: colors.outlineVariant,
            borderRadius: shape.large,
            marginHorizontal: spacing.extraLarge,
            marginTop: spacing.small,
            padding: spacing.medium,
          },
        ]}
      >
        <ContentTitle>Jot an idea</ContentTitle>
        <TextField
          value={idea}
          onChangeText={setIdea}
          accessibilityLabel="Draft idea"
          placeholder="What are you building, learning, or launching?"
          multiline
          textAlignVertical="top"
          style={[
            styles.ideaField,
            typography.bodyLarge,
            { backgroundColor: colors.surface, borderColor: "transparent" },
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
        <View style={[styles.attachRow, { gap: spacing.small }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={image ? "Replace image" : "Add image from library"}
            disabled={createDraft.isPending}
            onPress={() => void pickImage()}
            style={({ pressed }) => [
              styles.addTile,
              { borderColor: colors.outlineVariant, borderRadius: shape.small },
              pressed && { opacity: 0.6 },
            ]}
          >
            <ProtectedIcon role="gallery" size={24} tintColor={colors.primary} />
          </Pressable>
          <BodyText>{image ? "Replace image" : "Add image"}</BodyText>
        </View>
        {captureError ? (
          <BodyText accessibilityRole="alert" style={{ color: colors.error, marginTop: 6 }}>
            {captureError}
          </BodyText>
        ) : null}
        <View style={[styles.captureActions, { gap: spacing.small }]}>
          <Button
            title="Generate draft"
            intent="focal"
            onPress={() => void quickCapture(true)}
            disabled={createDraft.isPending || idea.trim().length === 0}
            loading={createDraft.isPending}
            style={{ flex: 1 }}
          />
          <Button
            title="Write it myself"
            intent="quiet"
            onPress={() => void quickCapture(false)}
            disabled={createDraft.isPending || (idea.trim().length === 0 && !image)}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          gap: spacing.medium,
          padding: spacing.extraLarge,
        }}
        refreshControl={
          <RefreshControl
            refreshing={drafts.isRefetching}
            onRefresh={() => void drafts.refetch()}
            tintColor={colors.onSurfaceVariant}
          />
        }
      >
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
        {list.length === 0 && hasDraftData ? (
          <EmptyState
            title="No drafts yet"
            body="Capture an idea above. It saves at once and opens in the composer."
          />
        ) : null}
        {list.map((draft) => (
          <DraftRow
            key={draft.id}
            draft={draft}
            onOpen={() => {
              const workspaceId = currentWorkspaceId();
              void prefetchPublicationEditor(queryClient, workspaceId, draft.id);
              router.push({ pathname: "/publications/[id]/edit", params: { id: draft.id } });
            }}
          />
        ))}
      </ScrollView>

      {menuOpen ? (
        <WorkspaceMenu onClose={() => setMenuOpen(false)} workspaces={workspaces.data ?? []} />
      ) : null}
    </Screen>
  );
}

function MenuButton({ onOpen }: { onOpen: () => void }) {
  return <IconButton label="Open workspace menu" role="more" onPress={onOpen} />;
}

function DraftRow({ draft, onOpen }: { draft: PublicationListItem; onOpen: () => void }) {
  const theme = useNativeTheme();
  const { colors, typography } = theme.manifest;
  const excerpt = firstRenditionBody(draft) ?? draft.title ?? "Untitled draft";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${excerpt}. Edited ${relativeTime(draft.updated_at)}`}
      onPress={onOpen}
    >
      {({ pressed }) => (
        <Card style={[styles.row, pressed && { opacity: 0.6 }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <ContentTitle numberOfLines={1}>{excerpt}</ContentTitle>
            <BodyText>Edited {relativeTime(draft.updated_at)}</BodyText>
          </View>
        </Card>
      )}
    </Pressable>
  );
}

function firstRenditionBody(draft: PublicationListItem): string | null {
  for (const rendition of draft.renditions ?? []) {
    if (rendition.body) return rendition.body;
  }
  return null;
}

function WorkspaceMenu({
  onClose,
  workspaces,
}: {
  onClose: () => void;
  workspaces: { id: string; name?: string | null }[];
}) {
  const theme = useNativeTheme();
  const { colors, spacing, typography } = theme.manifest;
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const server = getServer();
  const activeWorkspace = workspaces.find((workspace) => workspace.id === getWorkspaceId());
  return (
    <BottomDrawer onDismiss={onClose} open title="Workspace">
      <View style={[styles.menu, { gap: spacing.extraSmall }]}>
        {workspaces.length > 1 ? (
          <Pressable
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
          </Pressable>
        ) : null}
        <Pressable
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
        </Pressable>
        {server ? (
          <Pressable
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
          </Pressable>
        ) : null}
        <Pressable
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
        </Pressable>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
  },
  capture: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  ideaField: {
    minHeight: 104,
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
  attachRow: {
    alignItems: "center",
    flexDirection: "row",
  },
  addTile: {
    alignItems: "center",
    borderStyle: "dashed",
    borderWidth: 1.5,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  captureActions: {
    alignItems: "center",
    flexDirection: "row",
  },
  row: {
    paddingVertical: 14,
  },
  menu: {
    width: "100%",
  },
  menuRow: {
    minHeight: 48,
    justifyContent: "center",
  },
});
