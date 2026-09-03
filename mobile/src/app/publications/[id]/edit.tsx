import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  BodyText,
  Button,
  Card,
  IconButton,
  Screen,
  SectionHeader,
  StatusBadge,
  TextField,
} from "@/components/ui";
import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";
import { CelebrationBurst } from "@/components/celebration-burst";
import { BottomDrawer } from "@/components/bottom-drawer";
import { ThemeIcon } from "@/components/theme-icon";
import { ProtectedIcon } from "@/components/protected-icon";
import { api, errorMessage, type Api } from "@/lib/api/client";
import { applyPickerValue, firstPickerStep, type PickerStep } from "@/lib/date-time-picker";
import { accountHandle, formatDateTime, platformLabel } from "@/lib/format";
import { errorHaptic, selectionHaptic, successHaptic } from "@/lib/haptics";
import { uploadAttachment, type PendingAttachment } from "@/lib/media";
import { takePendingAttachments } from "@/lib/share";
import { invalidatePublicationData, type Publication } from "@/lib/query-cache";
import { currentWorkspaceId, useAccounts, usePublication, useSocialSets } from "@/lib/queries";
import type { PublicationActivity } from "@/lib/query-policy";
import { getWorkspaceId } from "@/lib/api/token-store";
import {
  captureWorkspaceQueryScope,
  queryActorScopeIsCurrent,
  requireCurrentQueryActor,
  requireCurrentQuerySession,
  workspaceQueryScopeIsCurrent,
  type WorkspaceQueryScope,
} from "@/lib/query-session";
import { useNativeTheme, withAlpha } from "@/theme";

type Attachment = {
  localId: string;
  uri?: string;
  mediaId?: string;
  mimeType: string;
  filename: string;
  size: number | null;
  status: "local" | "uploading" | "ready" | "error";
};

function attachmentsFromPublication(pub: PublicationDetail): Attachment[] {
  return (pub.media ?? []).map((media) => ({
    localId: `remote-${media.id}`,
    mediaId: media.id,
    mimeType: media.mime_type ?? "image/jpeg",
    filename: media.original_filename ?? media.id,
    size: media.size ?? null,
    status: "ready" as const,
  }));
}

type PublicationDetail = Publication;
type AccountsQuery = ReturnType<typeof useAccounts>;
type SocialSetsQuery = ReturnType<typeof useSocialSets>;
type EditorMutationScope = WorkspaceQueryScope & {
  publicationId: string;
  originalActivity: PublicationActivity;
  originalCalendarEntry: boolean;
};

function bodyFromPublication(pub: PublicationDetail): string {
  return pub.source_text ?? pub.renditions?.find((rendition) => rendition.body)?.body ?? "";
}

function selectedAccountsFromPublication(pub: PublicationDetail): Set<string> {
  return new Set(
    (pub.renditions ?? []).map((rendition) => rendition.social_account_id).filter(Boolean),
  );
}

function renditionBodiesFromPublication(pub: PublicationDetail): Record<string, string> {
  const bodies: Record<string, string> = {};
  for (const rendition of pub.renditions ?? []) {
    if (
      rendition.social_account_id &&
      rendition.body &&
      rendition.body !== (pub.source_text ?? "")
    ) {
      bodies[rendition.social_account_id] = rendition.body;
    }
  }
  return bodies;
}

function captureEditorMutationScope(
  publicationId: string,
  originalActivity: PublicationActivity,
  originalCalendarEntry: boolean,
): EditorMutationScope {
  return {
    ...captureWorkspaceQueryScope(currentWorkspaceId()),
    publicationId,
    originalActivity,
    originalCalendarEntry,
  };
}

function workspaceScopeIsCurrent(scope: WorkspaceQueryScope): boolean {
  return workspaceQueryScopeIsCurrent(scope, getWorkspaceId());
}

export default function ComposeScreen() {
  const { id, build, celebrate } = useLocalSearchParams<{
    id: string;
    build?: string;
    celebrate?: string;
  }>();

  const publication = usePublication(id);
  const accounts = useAccounts();
  const socialSets = useSocialSets();

  if (publication.isPending && !publication.data) {
    return (
      <Screen style={styles.coldState}>
        <Stack.Screen options={{ headerShown: false }} />
        <DelayedQueryPlaceholder
          pending
          shape="editor"
          offline={publication.fetchStatus === "paused"}
        />
      </Screen>
    );
  }

  if (!publication.data) {
    return (
      <Screen style={styles.coldState}>
        <Stack.Screen options={{ headerShown: false }} />
        <InitialQueryError
          title="Could not open this draft"
          message={
            publication.error instanceof Error ? publication.error.message : "Failed to load"
          }
          retry={() => void publication.refetch()}
          secondaryAction={{ label: "Close", onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  return (
    <Composer
      key={String(id)}
      buildOnOpen={build === "1"}
      celebrateOnOpen={celebrate === "1"}
      id={id}
      pub={publication.data}
      accounts={accounts}
      socialSets={socialSets}
      refreshError={publication.isError}
      refreshPaused={publication.fetchStatus === "paused"}
      onRefreshPublication={() => void publication.refetch()}
    />
  );
}

function Composer({
  id,
  pub,
  accounts,
  socialSets,
  refreshError,
  refreshPaused,
  onRefreshPublication,
  buildOnOpen,
  celebrateOnOpen,
}: {
  id: string;
  pub: PublicationDetail;
  accounts: AccountsQuery;
  socialSets: SocialSetsQuery;
  refreshError: boolean;
  refreshPaused: boolean;
  onRefreshPublication: () => void;
  buildOnOpen: boolean;
  celebrateOnOpen: boolean;
}) {
  const theme = useNativeTheme();
  const { colors, editor, typography } = theme.manifest;
  const queryClient = useQueryClient();
  const [initialPendingAttachments] = useState(() => takePendingAttachments());
  const editorDirty = useRef(initialPendingAttachments.length > 0);

  const [body, setBody] = useState(() => bodyFromPublication(pub));
  const [revision, setRevision] = useState(pub.revision ?? 0);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(
    pub.scheduled_at ? new Date(pub.scheduled_at) : null,
  );
  const [pickerStep, setPickerStep] = useState<PickerStep | null>(null);
  const [destinationDrawerOpen, setDestinationDrawerOpen] = useState(false);
  const [scheduleDrawerOpen, setScheduleDrawerOpen] = useState(false);
  const [selectedSocialSetId, setSelectedSocialSetId] = useState(pub.social_set_id ?? "");
  const [selectionTouched, setSelectionTouched] = useState((pub.renditions?.length ?? 0) > 0);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(() =>
    selectedAccountsFromPublication(pub),
  );
  const [renditionBodies, setRenditionBodies] = useState<Record<string, string>>(() =>
    renditionBodiesFromPublication(pub),
  );
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [celebrationTrigger, setCelebrationTrigger] = useState(celebrateOnOpen ? 1 : 0);
  const [attachments, setAttachments] = useState<Attachment[]>(() => [
    ...attachmentsFromPublication(pub),
    ...initialPendingAttachments.map((pending) => ({
      localId: pending.localId,
      uri: pending.uri,
      mimeType: pending.mimeType,
      filename: pending.filename,
      size: pending.size,
      status: "local" as const,
    })),
  ]);
  const initialMediaIds = pub.media?.map((media) => media.id) ?? [];
  const autoBuildStarted = useRef(false);
  const celebratedIdea = useRef(celebrateOnOpen);

  useEffect(() => {
    if (editorDirty.current) return;
    setBody(bodyFromPublication(pub));
    setRevision(pub.revision ?? 0);
    setScheduledAt(pub.scheduled_at ? new Date(pub.scheduled_at) : null);
    setSelectedSocialSetId(pub.social_set_id ?? "");
    setSelectionTouched((pub.renditions?.length ?? 0) > 0);
    setSelectedAccounts(selectedAccountsFromPublication(pub));
    setRenditionBodies(renditionBodiesFromPublication(pub));
    setAttachments((current) => [
      ...attachmentsFromPublication(pub),
      ...current.filter((attachment) => !attachment.mediaId),
    ]);
  }, [pub]);

  const defaultSocialSet = socialSets.data?.find((set) => set.is_default) ?? socialSets.data?.[0];
  const defaultAccountIDs =
    defaultSocialSet?.accounts?.map((account) => account.social_account_id) ??
    accounts.data?.map((account) => account.id) ??
    [];
  const activeAccounts = selectionTouched ? selectedAccounts : new Set(defaultAccountIDs);
  const activeSocialSetId = selectionTouched
    ? selectedSocialSetId
    : (defaultSocialSet?.id ?? selectedSocialSetId);
  const originalActivity = publicationActivity(pub.status);
  const originalCalendarEntry =
    originalActivity === "scheduled" || originalActivity === "published";
  const destinationCatalogFailed = accounts.isError || socialSets.isError;
  const accountsLoadedEmpty = (accounts.data?.length ?? 0) === 0 && accounts.data !== undefined;

  function markEditorDirty(): void {
    editorDirty.current = true;
  }

  function invalidate(
    scope: EditorMutationScope,
    {
      activities,
      calendar = false,
    }: {
      activities: readonly PublicationActivity[];
      calendar?: boolean;
    },
  ) {
    if (!queryActorScopeIsCurrent(scope)) return;
    void invalidatePublicationData(queryClient, {
      workspaceId: scope.workspaceId,
      publicationId: scope.publicationId,
      activities,
      calendar,
    });
  }

  async function httpError(response: Response | undefined, fallback: string): Promise<Error> {
    if (response?.status === 409) {
      return new Error("This post changed elsewhere. Close and reopen it before trying again.");
    }
    return new Error(await errorMessage(response, fallback));
  }

  async function resolveAttachments(
    scope: WorkspaceQueryScope,
    requestApi: Api,
  ): Promise<string[]> {
    const mediaIds: string[] = [];
    for (const attachment of attachments) {
      if (attachment.mediaId) {
        mediaIds.push(attachment.mediaId);
        continue;
      }
      if (!attachment.uri) continue;
      if (workspaceScopeIsCurrent(scope)) {
        setAttachments((current) =>
          current.map((item) =>
            item.localId === attachment.localId ? { ...item, status: "uploading" } : item,
          ),
        );
      }
      try {
        const pendingAttachment: PendingAttachment = {
          localId: attachment.localId,
          uri: attachment.uri,
          mimeType: attachment.mimeType,
          filename: attachment.filename,
          size: attachment.size,
        };
        const mediaId = await uploadAttachment(pendingAttachment, {
          client: requestApi,
          workspaceId: scope.workspaceId,
        });
        requireCurrentQueryActor(scope);
        mediaIds.push(mediaId);
        if (workspaceScopeIsCurrent(scope)) {
          setAttachments((current) =>
            current.map((item) =>
              item.localId === attachment.localId
                ? { ...item, mediaId, status: "ready" as const }
                : item,
            ),
          );
        }
      } catch (err) {
        if (workspaceScopeIsCurrent(scope)) {
          setAttachments((current) =>
            current.map((item) =>
              item.localId === attachment.localId ? { ...item, status: "error" as const } : item,
            ),
          );
        }
        throw err instanceof Error ? err : new Error("Could not upload attachment");
      }
    }
    return mediaIds;
  }

  async function persist(
    scope: EditorMutationScope,
    requestApi: Api,
    scheduleOverride?: Date,
  ): Promise<number> {
    requireCurrentQueryActor(scope);
    let mediaChanged = false;
    for (const attachment of attachments) {
      if (!attachment.mediaId || !initialMediaIds.includes(attachment.mediaId)) {
        mediaChanged = true;
        break;
      }
    }
    if (attachments.length !== initialMediaIds.length) mediaChanged = true;

    const media = await resolveAttachments(scope, requestApi);
    requireCurrentQueryActor(scope);
    const desired = [...activeAccounts];
    const removed = (pub.renditions ?? []).filter(
      (rendition) =>
        rendition.social_account_id && !activeAccounts.has(rendition.social_account_id),
    );

    const initialScheduled = pub.scheduled_at ? new Date(pub.scheduled_at).getTime() : 0;
    const effectiveScheduledAt = scheduleOverride ?? scheduledAt;
    const scheduledChanged = (effectiveScheduledAt?.getTime() ?? 0) !== initialScheduled;

    const {
      data: updated,
      error,
      response,
    } = await requestApi.PUT("/publications/{id}", {
      params: { path: { id: scope.publicationId } },
      body: {
        expected_revision: revision,
        source_text: body,
        ...(activeSocialSetId ? { social_set_id: activeSocialSetId } : {}),
        ...(mediaChanged ? { media: media.map((mediaId) => ({ media_id: mediaId })) } : {}),
        ...(scheduledChanged
          ? effectiveScheduledAt
            ? { scheduled_at: effectiveScheduledAt.toISOString() }
            : { clear_schedule: true }
          : {}),
      },
    });
    if (error) throw await httpError(response, "Could not save");
    requireCurrentQueryActor(scope);
    let nextRevision = updated?.revision ?? revision + 1;

    if (desired.length > 0) {
      const upsert = await requestApi.PUT("/publications/{id}/renditions", {
        params: { path: { id: scope.publicationId } },
        body: {
          expected_revision: nextRevision,
          renditions: desired.map((accountId) => ({
            social_account_id: accountId,
            body: renditionBodies[accountId]?.trim() ? renditionBodies[accountId] : undefined,
          })),
        },
      });
      if (upsert.error) throw await httpError(upsert.response, "Could not update destinations");
      requireCurrentQueryActor(scope);
      nextRevision = upsert.data?.revision ?? nextRevision + 1;
    }

    for (const rendition of removed) {
      if (!rendition.social_account_id) continue;
      const removal = await requestApi.DELETE("/publications/{id}/renditions/{account_id}", {
        params: {
          path: { id: scope.publicationId, account_id: rendition.social_account_id },
          query: { confirm: true, expected_revision: nextRevision },
        },
      });
      if (removal.error) throw await httpError(removal.response, "Could not remove destination");
      requireCurrentQueryActor(scope);
      nextRevision += 1;
    }

    if (workspaceScopeIsCurrent(scope)) setRevision(nextRevision);
    return nextRevision;
  }

  function handleError(
    err: Error,
    scope: EditorMutationScope,
    refresh?: { activities: readonly PublicationActivity[]; calendar?: boolean },
  ) {
    if (workspaceScopeIsCurrent(scope)) {
      setActionError(err.message);
      void errorHaptic();
    }
    if (refresh) {
      invalidate(scope, refresh);
    } else if (err.message.includes("changed elsewhere")) {
      invalidate(scope, { activities: [] });
    }
  }

  const saveAndClose = useMutation({
    mutationFn: (scope: EditorMutationScope) => {
      requireCurrentQuerySession(scope);
      return persist(scope, api());
    },
    onSuccess: (_, scope) => {
      invalidate(scope, {
        activities: [scope.originalActivity],
        calendar: scope.originalCalendarEntry,
      });
      if (workspaceScopeIsCurrent(scope)) router.back();
    },
    onError: (err, scope) =>
      handleError(err, scope, {
        activities: [scope.originalActivity],
        calendar: scope.originalCalendarEntry,
      }),
  });

  const scheduleMutation = useMutation({
    mutationFn: async (scope: EditorMutationScope) => {
      requireCurrentQuerySession(scope);
      if (!scheduledAt) throw new Error("Pick a time first");
      const requestApi = api();
      const nextRevision = await persist(scope, requestApi);
      const { error, response } = await requestApi.POST("/publications/{id}/schedule", {
        params: { path: { id: scope.publicationId } },
        body: { expected_revision: nextRevision },
      });
      if (error) throw await httpError(response, "Could not schedule");
      requireCurrentQueryActor(scope);
    },
    onSuccess: (_, scope) => {
      if (workspaceScopeIsCurrent(scope)) {
        void successHaptic();
        setStatusMessage("Queued for publishing");
        setTimeout(() => {
          if (workspaceScopeIsCurrent(scope)) router.back();
        }, 700);
      }
      invalidate(scope, { activities: [scope.originalActivity, "scheduled"], calendar: true });
    },
    onError: (err, scope) =>
      handleError(err, scope, {
        activities: [scope.originalActivity, "scheduled"],
        calendar: true,
      }),
  });

  const publishNow = useMutation({
    mutationFn: async (scope: EditorMutationScope) => {
      requireCurrentQuerySession(scope);
      const requestApi = api();
      const nextRevision = await persist(scope, requestApi);
      const { error, response } = await requestApi.POST("/publications/{id}/publish-now", {
        params: { path: { id: scope.publicationId } },
        body: { expected_revision: nextRevision },
      });
      if (error) throw await httpError(response, "Could not publish");
      requireCurrentQueryActor(scope);
    },
    onSuccess: (_, scope) => {
      if (workspaceScopeIsCurrent(scope)) {
        void successHaptic();
        router.back();
      }
      invalidate(scope, { activities: [scope.originalActivity, "scheduled"], calendar: true });
    },
    onError: (err, scope) =>
      handleError(err, scope, {
        activities: [scope.originalActivity, "scheduled"],
        calendar: true,
      }),
  });

  const deleteDraft = useMutation({
    mutationFn: async (scope: EditorMutationScope) => {
      requireCurrentQuerySession(scope);
      const { error, response } = await api().DELETE("/publications/{id}", {
        params: {
          path: { id: scope.publicationId },
          query: { confirm: true, expected_revision: revision },
        },
      });
      if (error) throw await httpError(response, "Could not delete");
      requireCurrentQueryActor(scope);
    },
    onSuccess: (_, scope) => {
      invalidate(scope, {
        activities: [scope.originalActivity],
        calendar: scope.originalCalendarEntry,
      });
      if (workspaceScopeIsCurrent(scope)) router.back();
    },
    onError: (err, scope) =>
      handleError(err, scope, {
        activities: [scope.originalActivity],
        calendar: scope.originalCalendarEntry,
      }),
  });

  const nextSlot = useMutation({
    mutationFn: async (scope: EditorMutationScope) => {
      requireCurrentQuerySession(scope);
      const { data, error, response } = await api().GET("/posting-schedules/next-slot", {
        params: { query: { workspace_id: scope.workspaceId } },
      });
      if (error || !data) throw new Error(await errorMessage(response, "No slot found"));
      requireCurrentQueryActor(scope);
      return new Date(data.slot_time);
    },
    onSuccess: (date, scope) => {
      if (!workspaceScopeIsCurrent(scope)) return;
      markEditorDirty();
      setScheduledAt(date);
      setPickerStep(null);
    },
    onError: (err, scope) => handleError(err, scope),
  });

  const queueNextSlot = useMutation({
    mutationFn: async (scope: EditorMutationScope) => {
      requireCurrentQuerySession(scope);
      if (activeAccounts.size === 0) throw new Error("Choose at least one destination");
      const requestApi = api();
      const { data, error, response } = await requestApi.GET("/posting-schedules/next-slot", {
        params: { query: { workspace_id: scope.workspaceId } },
      });
      if (error || !data) throw new Error(await errorMessage(response, "No slot found"));
      requireCurrentQueryActor(scope);
      const slot = new Date(data.slot_time);
      if (workspaceScopeIsCurrent(scope)) {
        markEditorDirty();
        setScheduledAt(slot);
      }
      const nextRevision = await persist(scope, requestApi, slot);
      const scheduled = await requestApi.POST("/publications/{id}/schedule", {
        params: { path: { id: scope.publicationId } },
        body: { expected_revision: nextRevision },
      });
      if (scheduled.error) throw await httpError(scheduled.response, "Could not queue post");
      requireCurrentQueryActor(scope);
      return slot;
    },
    onSuccess: (_, scope) => {
      if (workspaceScopeIsCurrent(scope)) {
        void successHaptic();
        router.back();
      }
      invalidate(scope, { activities: [scope.originalActivity, "scheduled"], calendar: true });
    },
    onError: (err, scope) =>
      handleError(err, scope, {
        activities: [scope.originalActivity, "scheduled"],
        calendar: true,
      }),
  });

  const generatePost = useMutation({
    mutationFn: async (scope: EditorMutationScope) => {
      requireCurrentQuerySession(scope);
      const idea = body.trim();
      if (!idea) throw new Error("Jot down an idea first");
      if (activeAccounts.size === 0) throw new Error("Choose at least one destination");
      const { data, error, response } = await api().POST("/post-builder/generate", {
        body: {
          workspace_id: scope.workspaceId,
          idea,
          social_account_ids: [...activeAccounts],
        },
      });
      if (error || !data)
        throw new Error(await errorMessage(response, "Could not generate this draft"));
      requireCurrentQueryActor(scope);
      return data;
    },
    onSuccess: (generated, scope) => {
      if (!workspaceScopeIsCurrent(scope)) return;
      markEditorDirty();
      setBody(generated.source_text);
      setRenditionBodies(
        Object.fromEntries(
          (generated.renditions ?? []).map((rendition) => [
            rendition.social_account_id,
            rendition.body,
          ]),
        ),
      );
      setStatusMessage("Generated draft ready. Review it before you queue it.");
      setActionError(null);
      void successHaptic();
      if (!celebratedIdea.current) {
        celebratedIdea.current = true;
        setCelebrationTrigger((current) => current + 1);
      }
    },
    onError: (err, scope) => handleError(err, scope),
  });

  useEffect(() => {
    if (!buildOnOpen || autoBuildStarted.current || activeAccounts.size === 0) return;
    autoBuildStarted.current = true;
    generatePost.mutate(captureEditorMutationScope(id, originalActivity, originalCalendarEntry));
  }, [activeAccounts.size, buildOnOpen, generatePost, id, originalActivity, originalCalendarEntry]);

  function toggleAccount(accountId: string) {
    markEditorDirty();
    void selectionHaptic();
    setSelectedAccounts(() => {
      const next = new Set(activeAccounts);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
    setSelectedSocialSetId("");
    setSelectionTouched(true);
  }

  function applySocialSet(setId: string, accountIds: string[]) {
    markEditorDirty();
    void selectionHaptic();
    setSelectedAccounts(new Set(accountIds));
    setSelectedSocialSetId(setId);
    setSelectionTouched(true);
  }

  function addAttachment(asset: ImagePicker.ImagePickerAsset) {
    markEditorDirty();
    void selectionHaptic();
    setAttachments((current) => [
      ...current,
      {
        localId: `local-${Date.now()}-${current.length}`,
        uri: asset.uri,
        mimeType: asset.mimeType ?? "image/jpeg",
        filename: asset.fileName ?? `photo-${Date.now()}.jpg`,
        size: asset.fileSize ?? null,
        status: "local",
      },
    ]);
  }

  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.9,
    });
    if (!result.canceled) {
      for (const asset of result.assets) addAttachment(asset);
    }
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setActionError("Camera permission is needed to take photos.");
      void errorHaptic();
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (!result.canceled && result.assets[0]) {
      addAttachment(result.assets[0]);
    }
  }

  function removeAttachment(localId: string) {
    markEditorDirty();
    setAttachments((current) => current.filter((item) => item.localId !== localId));
  }

  function moveAttachment(index: number, delta: -1 | 1) {
    markEditorDirty();
    setAttachments((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const isScheduled = pub.status === "scheduled" || pub.status === "publishing";

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.modalHeader, { borderBottomColor: colors.outlineVariant }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel editing"
          onPress={() => router.back()}
          style={styles.headerAction}
        >
          <Text style={[typography.bodyLarge, { color: colors.primary }]}>Cancel</Text>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <StatusBadge status={pub.status} />
          {saveAndClose.isPending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save draft"
          accessibilityState={{ disabled: saveAndClose.isPending }}
          onPress={() =>
            saveAndClose.mutate(
              captureEditorMutationScope(id, originalActivity, originalCalendarEntry),
            )
          }
          disabled={saveAndClose.isPending}
          style={styles.headerAction}
        >
          <Text
            style={[
              typography.labelLarge,
              {
                color: saveAndClose.isPending ? colors.onSurfaceVariant : colors.primary,
              },
            ]}
          >
            Done
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {statusMessage ? (
          <Card accessibilityRole="alert">
            <BodyText
              style={[
                typography.labelLarge,
                { color: colors.status.published, textAlign: "center" },
              ]}
            >
              {statusMessage}
            </BodyText>
          </Card>
        ) : null}
        {actionError ? (
          <BodyText accessibilityRole="alert" style={{ color: colors.error }}>
            {actionError}
          </BodyText>
        ) : null}
        {refreshError ? (
          <QueryNotice
            message="Could not refresh this draft. You can keep editing this copy."
            retry={onRefreshPublication}
          />
        ) : null}
        {refreshPaused ? (
          <QueryNotice message="You are offline. You can keep editing the current draft." offline />
        ) : null}

        <View style={styles.editorHeading}>
          <View style={styles.editorHeadingCopy}>
            <Text
              accessibilityRole="header"
              style={[typography.titleLarge, { color: colors.onSurface }]}
            >
              Post
            </Text>
            <BodyText>One idea, adapted for every destination</BodyText>
          </View>
          <Button
            title={generatePost.isPending ? "Generating..." : "Generate draft"}
            intent="ordinary"
            onPress={() =>
              generatePost.mutate(
                captureEditorMutationScope(id, originalActivity, originalCalendarEntry),
              )
            }
            disabled={generatePost.isPending || activeAccounts.size === 0 || !body.trim()}
            loading={generatePost.isPending}
            style={styles.aiButton}
          />
        </View>
        <TextField
          value={body}
          onChangeText={(text) => {
            markEditorDirty();
            setBody(text);
          }}
          accessibilityLabel="Post text"
          placeholder="What do you want to say?"
          multiline
          textAlignVertical="top"
          style={[
            styles.writingField,
            {
              backgroundColor: colors.surface,
              borderColor: colors.outlineVariant,
            },
          ]}
        />

        <View style={styles.attachmentList}>
          {attachments.map((attachment, index) => (
            <View
              key={attachment.localId}
              style={[
                styles.attachmentRow,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.outlineVariant,
                },
              ]}
            >
              <View style={styles.thumbWrap}>
                {attachment.uri && attachment.mimeType.startsWith("image/") ? (
                  <Image source={{ uri: attachment.uri }} style={styles.thumb} contentFit="cover" />
                ) : (
                  <View
                    style={[
                      styles.thumb,
                      styles.thumbPlaceholder,
                      { backgroundColor: colors.surfaceContainerHigh },
                    ]}
                  >
                    <ProtectedIcon
                      role={attachment.mimeType.startsWith("video/") ? "video" : "image"}
                      size={24}
                      tintColor={colors.onSurfaceVariant}
                    />
                  </View>
                )}
                {attachment.status === "uploading" ? (
                  <View
                    accessible
                    accessibilityLabel={`Uploading ${attachment.filename}`}
                    accessibilityRole="progressbar"
                    style={[styles.thumbOverlay, { backgroundColor: editor.mediaScrim }]}
                  >
                    <ActivityIndicator size="small" color={editor.canvasSelectionText} />
                  </View>
                ) : attachment.status === "error" ? (
                  <View
                    accessible
                    accessibilityLabel={`Upload failed for ${attachment.filename}`}
                    accessibilityRole="alert"
                    style={[styles.thumbOverlay, { backgroundColor: editor.mediaScrim }]}
                  >
                    <ProtectedIcon
                      role="warning"
                      size={18}
                      tintColor={editor.canvasSelectionText}
                    />
                  </View>
                ) : null}
              </View>
              <View style={styles.attachmentDetails}>
                <BodyText numberOfLines={1} style={{ color: colors.onSurface }}>
                  {attachment.filename}
                </BodyText>
                <View style={styles.attachmentActions}>
                  {index > 0 ? (
                    <IconButton
                      label="Move attachment earlier"
                      role="back"
                      onPress={() => moveAttachment(index, -1)}
                    />
                  ) : null}
                  {index < attachments.length - 1 ? (
                    <IconButton
                      label="Move attachment later"
                      role="next"
                      onPress={() => moveAttachment(index, 1)}
                    />
                  ) : null}
                  <IconButton
                    label={`Remove ${attachment.filename}`}
                    role="delete"
                    color={colors.error}
                    onPress={() => removeAttachment(attachment.localId)}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
        <View style={styles.attachRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add photos or videos from library"
            onPress={() => void pickFromLibrary()}
            style={({ pressed }) => [
              styles.addTile,
              { borderColor: colors.outlineVariant },
              pressed && { opacity: 0.6 },
            ]}
          >
            <ProtectedIcon role="gallery" size={24} tintColor={colors.primary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take a photo"
            onPress={() => void takePhoto()}
            style={({ pressed }) => [
              styles.addTile,
              { borderColor: colors.outlineVariant },
              pressed && { opacity: 0.6 },
            ]}
          >
            <ProtectedIcon role="camera" size={24} tintColor={colors.primary} />
          </Pressable>
        </View>

        <SectionHeader label="Publishing" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose Social Set and destinations"
          onPress={() => setDestinationDrawerOpen(true)}
        >
          {({ pressed }) => (
            <Card style={[styles.settingCard, pressed && { opacity: 0.65 }]}>
              <View style={styles.settingIcon}>
                <ThemeIcon role="account" size={22} tintColor={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[typography.titleMedium, { color: colors.onSurface }]}>
                  Social Set
                </Text>
                <BodyText numberOfLines={1}>
                  {selectedSetLabel(socialSets.data ?? [], activeSocialSetId, activeAccounts.size)}
                </BodyText>
              </View>
              <ThemeIcon role="disclosure" size={20} tintColor={colors.onSurfaceVariant} />
            </Card>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose a custom publishing time"
          onPress={() => setScheduleDrawerOpen(true)}
        >
          {({ pressed }) => (
            <Card style={[styles.settingCard, pressed && { opacity: 0.65 }]}>
              <View style={styles.settingIcon}>
                <ThemeIcon role="calendar" size={22} tintColor={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[typography.titleMedium, { color: colors.onSurface }]}>
                  Publish time
                </Text>
                <BodyText>
                  {scheduledAt
                    ? formatDateTime(scheduledAt.toISOString())
                    : "Use the next open slot"}
                </BodyText>
              </View>
              <ThemeIcon role="disclosure" size={20} tintColor={colors.onSurfaceVariant} />
            </Card>
          )}
        </Pressable>

        <View style={styles.footer}>
          {pub.status !== "published" && pub.status !== "publishing" ? (
            <Button
              title="Publish now"
              intent="ordinary"
              onPress={() =>
                publishNow.mutate(
                  captureEditorMutationScope(id, originalActivity, originalCalendarEntry),
                )
              }
              disabled={publishNow.isPending || activeAccounts.size === 0}
            />
          ) : null}
          <Button
            title="Delete draft"
            intent="destructive"
            onPress={() =>
              Alert.alert("Delete draft?", "This cannot be undone.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () =>
                    deleteDraft.mutate(
                      captureEditorMutationScope(id, originalActivity, originalCalendarEntry),
                    ),
                },
              ])
            }
            disabled={deleteDraft.isPending}
          />
        </View>
      </ScrollView>
      {!isScheduled ? (
        <View
          style={[
            styles.stickyFooter,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.outlineVariant,
            },
          ]}
        >
          <Button
            title="Queue next slot"
            intent="focal"
            onPress={() =>
              queueNextSlot.mutate(
                captureEditorMutationScope(id, originalActivity, originalCalendarEntry),
              )
            }
            disabled={queueNextSlot.isPending || activeAccounts.size === 0 || !body.trim()}
            loading={queueNextSlot.isPending}
            style={{ flex: 1 }}
          />
          <IconButton
            label="Choose publishing time"
            role="calendar"
            onPress={() => setScheduleDrawerOpen(true)}
          />
        </View>
      ) : null}

      {destinationDrawerOpen ? (
        <BottomDrawer open title="Social Set" onDismiss={() => setDestinationDrawerOpen(false)}>
          {(socialSets.data?.length ?? 0) > 0 ? (
            <View style={styles.chipRow}>
              {[...(socialSets.data ?? [])]
                .sort((a, b) => Number(b.is_default === true) - Number(a.is_default === true))
                .map((set) => (
                  <Chip
                    key={set.id}
                    label={set.name ?? "Social Set"}
                    active={activeSocialSetId === set.id}
                    onPress={() =>
                      applySocialSet(
                        set.id,
                        (set.accounts ?? []).map((account) => account.social_account_id),
                      )
                    }
                  />
                ))}
            </View>
          ) : null}
          <BodyText>Choose a saved set or fine-tune the accounts below.</BodyText>
          {(accounts.data === undefined && accounts.isPending) ||
          (socialSets.data === undefined && socialSets.isPending) ? (
            <DelayedQueryPlaceholder
              pending
              shape="list"
              offline={accounts.fetchStatus === "paused" || socialSets.fetchStatus === "paused"}
            />
          ) : null}
          {destinationCatalogFailed ? (
            <QueryNotice
              message={
                accounts.data !== undefined || socialSets.data !== undefined
                  ? "Could not refresh every destination. Current destinations remain visible."
                  : "Could not load your Social Sets and accounts."
              }
              retry={() => {
                void accounts.refetch();
                void socialSets.refetch();
              }}
            />
          ) : null}
          {(accounts.data !== undefined || socialSets.data !== undefined) &&
          (accounts.fetchStatus === "paused" || socialSets.fetchStatus === "paused") ? (
            <QueryNotice message="You are offline. Current destinations remain visible." offline />
          ) : null}
          {accountsLoadedEmpty && !destinationCatalogFailed ? (
            <Card>
              <BodyText>No connected accounts. Connect them in the web app first.</BodyText>
            </Card>
          ) : (
            <View style={styles.accountList}>
              {(accounts.data ?? []).map((account) => {
                const selected = activeAccounts.has(account.id);
                return (
                  <View key={account.id}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      onPress={() => toggleAccount(account.id)}
                      style={({ pressed }) => [
                        styles.accountRow,
                        {
                          backgroundColor: colors.background,
                          borderColor: selected ? colors.primary : colors.outlineVariant,
                        },
                        pressed && { opacity: 0.65 },
                      ]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: selected ? colors.primary : colors.outlineVariant,
                            backgroundColor: selected ? colors.primary : "transparent",
                          },
                        ]}
                      >
                        {selected ? (
                          <ThemeIcon role="check" size={15} tintColor={colors.onPrimary} />
                        ) : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[typography.labelLarge, { color: colors.onSurface }]}>
                          {accountHandle(account.account_username, account.slug)}
                        </Text>
                        <BodyText>{platformLabel(account.platform)}</BodyText>
                      </View>
                      {selected ? (
                        <Button
                          title={expandedAccount === account.id ? "Hide" : "Customize"}
                          intent="quiet"
                          onPress={() =>
                            setExpandedAccount(expandedAccount === account.id ? null : account.id)
                          }
                          style={styles.customizeButton}
                        />
                      ) : null}
                    </Pressable>
                    {selected && expandedAccount === account.id ? (
                      <TextField
                        value={renditionBodies[account.id] ?? ""}
                        accessibilityLabel={`Custom text for ${platformLabel(account.platform)}`}
                        onChangeText={(text) => {
                          markEditorDirty();
                          setRenditionBodies((current) => ({
                            ...current,
                            [account.id]: text,
                          }));
                        }}
                        placeholder="Leave empty to use the main post"
                        multiline
                        textAlignVertical="top"
                        style={styles.overrideField}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
          <Button
            title="Done"
            onPress={() => setDestinationDrawerOpen(false)}
            disabled={activeAccounts.size === 0}
          />
        </BottomDrawer>
      ) : null}

      {scheduleDrawerOpen ? (
        <BottomDrawer open title="Publish time" onDismiss={() => setScheduleDrawerOpen(false)}>
          <Card style={styles.scheduleCard}>
            <Text style={[typography.titleMedium, { color: colors.onSurface }]}>
              {scheduledAt ? formatDateTime(scheduledAt.toISOString()) : "Not scheduled"}
            </Text>
            <View style={styles.scheduleActions}>
              <Button
                title={pickerStep ? "Hide picker" : "Pick date and time"}
                intent="ordinary"
                onPress={() =>
                  setPickerStep((current) =>
                    current ? null : firstPickerStep(Platform.OS === "android" ? "android" : "ios"),
                  )
                }
              />
              <Button
                title="Use next slot"
                intent="ordinary"
                onPress={() =>
                  nextSlot.mutate(
                    captureEditorMutationScope(id, originalActivity, originalCalendarEntry),
                  )
                }
                loading={nextSlot.isPending}
              />
              {scheduledAt ? (
                <Button
                  title="Clear"
                  intent="quiet"
                  onPress={() => {
                    markEditorDirty();
                    setScheduledAt(null);
                  }}
                />
              ) : null}
            </View>
            {pickerStep ? (
              <DateTimePicker
                value={scheduledAt ?? nextHour()}
                mode={pickerStep}
                onChange={(event, date) => {
                  if (event.type !== "set" || !date) {
                    setPickerStep(null);
                    return;
                  }
                  const result = applyPickerValue(scheduledAt ?? nextHour(), date, pickerStep);
                  markEditorDirty();
                  setScheduledAt(result.value);
                  setPickerStep(result.nextStep);
                }}
              />
            ) : null}
          </Card>
          <Button
            title="Schedule and queue"
            intent="focal"
            onPress={() =>
              scheduleMutation.mutate(
                captureEditorMutationScope(id, originalActivity, originalCalendarEntry),
              )
            }
            disabled={!scheduledAt || scheduleMutation.isPending || activeAccounts.size === 0}
            loading={scheduleMutation.isPending}
          />
        </BottomDrawer>
      ) : null}
      <CelebrationBurst trigger={celebrationTrigger} />
    </Screen>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useNativeTheme();
  const { colors, typography } = theme.manifest;
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        pressed && { opacity: 0.6 },
        {
          backgroundColor: active ? withAlpha(colors.primary, 0.15) : colors.surface,
          borderColor: active ? colors.primary : colors.outlineVariant,
        },
      ]}
    >
      <Text style={[typography.labelMedium, { color: active ? colors.primary : colors.onSurface }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function nextHour(): Date {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return date;
}

function selectedSetLabel(
  sets: { id: string; name?: string | null }[],
  selectedSetId: string,
  accountCount: number,
): string {
  const selectedSet = sets.find((set) => set.id === selectedSetId);
  if (selectedSet?.name) return `${selectedSet.name} · ${accountCount} destinations`;
  return `${accountCount} ${accountCount === 1 ? "destination" : "destinations"}`;
}

function publicationActivity(status: string): PublicationActivity {
  if (status === "scheduled" || status === "publishing") return "scheduled";
  if (status === "published") return "published";
  if (status === "failed") return "failed";
  return "draft";
}

const styles = StyleSheet.create({
  coldState: {
    paddingHorizontal: 20,
    paddingTop: 72,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerAction: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 20,
    gap: 12,
    paddingBottom: 120,
  },
  editorHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  editorHeadingCopy: {
    flex: 1,
    minWidth: 0,
  },
  aiButton: {
    minHeight: 48,
    paddingHorizontal: 14,
  },
  writingField: {
    minHeight: 260,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  attachRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  attachmentList: {
    gap: 8,
  },
  attachmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 80,
    padding: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  attachmentDetails: {
    flex: 1,
    gap: 2,
  },
  attachmentActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    minHeight: 48,
  },
  thumbWrap: {
    width: 64,
    height: 64,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
  },
  thumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  thumbOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  addTile: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  accountList: {
    gap: 8,
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    minHeight: 52,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  overrideField: {
    marginTop: 4,
    minHeight: 112,
    paddingTop: 12,
  },
  customizeButton: {
    minHeight: 48,
    paddingHorizontal: 8,
  },
  settingCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 68,
  },
  settingIcon: {
    alignItems: "center",
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  scheduleCard: {
    gap: 10,
  },
  scheduleActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  footer: {
    gap: 10,
    marginTop: 8,
  },
  stickyFooter: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    flexDirection: "row",
    gap: 10,
    left: 0,
    paddingBottom: 10,
    paddingHorizontal: 20,
    paddingTop: 10,
    position: "absolute",
    right: 0,
  },
});
