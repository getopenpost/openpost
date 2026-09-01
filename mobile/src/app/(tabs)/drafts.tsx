import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
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
import { useShareIntentContext } from "expo-share-intent";

import { BottomDrawer } from "@/components/bottom-drawer";
import { BodyText, Button, Card, IconButton, Screen, TextField, useColors } from "@/components/ui";
import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";
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
  querySessionIsCurrent,
  requireCurrentQuerySession,
  workspaceQueryScopeIsCurrent,
  type WorkspaceQueryScope,
} from "@/lib/query-session";
import { getServer } from "@/lib/server";
import { signOut } from "@/lib/auth";

type CreateDraftRequest = {
  scope: WorkspaceQueryScope;
  text: string;
};

export default function DraftsScreen() {
  const colors = useColors();
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
      if (!querySessionIsCurrent(scope)) return;
      await queryClient.cancelQueries({
        queryKey: queryKeys.publicationActivity(scope.workspaceId, "draft"),
        exact: true,
      });
      if (!querySessionIsCurrent(scope)) return;
      cacheCreatedPublication(queryClient, scope.workspaceId, publication);
      void invalidatePublicationData(queryClient, {
        workspaceId: scope.workspaceId,
        activities: ["draft"],
      });
    },
    onError: (_, { scope }) => {
      if (!querySessionIsCurrent(scope)) return;
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
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>Drafts</Text>
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
        style={[styles.capture, { backgroundColor: colors.card, borderColor: colors.separator }]}
      >
        <Text style={[styles.captureTitle, { color: colors.text }]}>Jot an idea</Text>
        <TextField
          value={idea}
          onChangeText={setIdea}
          accessibilityLabel="Draft idea"
          placeholder="What are you building, learning, or launching?"
          multiline
          textAlignVertical="top"
          style={[styles.ideaField, { backgroundColor: colors.card, borderColor: "transparent" }]}
        />
        {image ? (
          <View
            style={[
              styles.attachmentRow,
              { backgroundColor: colors.card, borderColor: colors.separator },
            ]}
          >
            <Image source={{ uri: image.uri }} style={styles.attachmentThumb} contentFit="cover" />
            <BodyText numberOfLines={1} style={{ color: colors.text, flex: 1 }}>
              {image.filename}
            </BodyText>
            <IconButton
              label={`Remove ${image.filename}`}
              name={{ ios: "trash", android: "delete" }}
              color={colors.danger}
              onPress={() => setImage(null)}
            />
          </View>
        ) : null}
        <View style={styles.attachRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={image ? "Replace image" : "Add image from library"}
            disabled={createDraft.isPending}
            onPress={() => void pickImage()}
            style={({ pressed }) => [
              styles.addTile,
              { borderColor: colors.separator },
              pressed && { opacity: 0.6 },
            ]}
          >
            <SymbolView
              name={{ ios: "photo.badge.plus", android: "add_photo_alternate" }}
              size={24}
              tintColor={colors.tint}
            />
          </Pressable>
          <BodyText>{image ? "Replace image" : "Add image"}</BodyText>
        </View>
        {captureError ? (
          <BodyText accessibilityRole="alert" style={{ color: colors.danger, marginTop: 6 }}>
            {captureError}
          </BodyText>
        ) : null}
        <View style={styles.captureActions}>
          <Button
            title="Generate draft"
            variant="focal"
            onPress={() => void quickCapture(true)}
            disabled={createDraft.isPending || idea.trim().length === 0}
            loading={createDraft.isPending}
            style={{ flex: 1 }}
          />
          <Button
            title="Write it myself"
            variant="plain"
            onPress={() => void quickCapture(false)}
            disabled={createDraft.isPending || (idea.trim().length === 0 && !image)}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={drafts.isRefetching}
            onRefresh={() => void drafts.refetch()}
            tintColor={colors.textSecondary}
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
          <Card style={styles.empty}>
            <BodyText style={{ textAlign: "center" }}>
              No drafts yet. Capture an idea above. It saves at once and opens in the composer.
            </BodyText>
          </Card>
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
  return (
    <IconButton
      label="Open workspace menu"
      name={{ ios: "ellipsis", android: "more_vert" }}
      onPress={onOpen}
    />
  );
}

function DraftRow({ draft, onOpen }: { draft: PublicationListItem; onOpen: () => void }) {
  const colors = useColors();
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
            <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
              {excerpt}
            </Text>
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
  const colors = useColors();
  const server = getServer();
  const activeWorkspace = workspaces.find((workspace) => workspace.id === getWorkspaceId());
  return (
    <BottomDrawer onDismiss={onClose} open title="Workspace">
      <View style={styles.menu}>
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
            style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.5 }]}
          >
            <Text style={{ color: colors.text, fontSize: 16 }}>Switch workspace</Text>
            <BodyText>{activeWorkspace?.name ?? "Choose another workspace"}</BodyText>
          </Pressable>
        ) : null}
        {server ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              onClose();
              void Linking.openURL(server.baseUrl);
            }}
            style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.5 }]}
          >
            <Text style={{ color: colors.tint, fontSize: 16 }}>Open web app</Text>
            <BodyText>Manage accounts and settings</BodyText>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onClose();
            void signOut().then(() => router.replace("/"));
          }}
          style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.5 }]}
        >
          <Text style={{ color: colors.danger, fontSize: 16 }}>Sign out</Text>
        </Pressable>
      </View>
    </BottomDrawer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  capture: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
    marginTop: 8,
    padding: 14,
  },
  captureTitle: {
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  ideaField: {
    fontSize: 17,
    lineHeight: 25,
    minHeight: 104,
    paddingHorizontal: 0,
    paddingTop: 10,
  },
  attachmentRow: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    minHeight: 80,
    padding: 8,
  },
  attachmentThumb: {
    borderRadius: 10,
    height: 64,
    width: 64,
  },
  attachRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  addTile: {
    alignItems: "center",
    borderRadius: 10,
    borderStyle: "dashed",
    borderWidth: 1.5,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  captureActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  list: {
    padding: 20,
    gap: 10,
  },
  empty: {
    marginTop: 16,
  },
  row: {
    paddingVertical: 14,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "500",
  },
  menu: {
    width: "100%",
    gap: 4,
  },
  menuRow: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
    gap: 2,
  },
});
