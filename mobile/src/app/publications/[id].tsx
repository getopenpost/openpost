import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";
import {
  BodyText,
  Button,
  Card,
  Screen,
  StatusBadge,
  SectionHeader,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { applyPickerValue, firstPickerStep, type PickerStep } from "@/lib/date-time-picker";
import { formatDateTime, platformLabel, statusColor } from "@/lib/format";
import { errorHaptic, successHaptic } from "@/lib/haptics";
import { invalidatePublicationData } from "@/lib/query-cache";
import { currentWorkspaceId, prefetchPublicationEditor, usePublication } from "@/lib/queries";
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
import { useNativeTheme } from "@/theme";

type PublicationMutationScope = WorkspaceQueryScope & {
  publicationId: string;
};

type RescheduleRequest = {
  scope: PublicationMutationScope;
  when: Date;
};

export default function PostScreen() {
  const theme = useNativeTheme();
  const { colors, spacing, typography } = theme.manifest;
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [pickerStep, setPickerStep] = useState<PickerStep | null>(null);
  const [newDate, setNewDate] = useState<Date | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const publication = usePublication(id, "live");

  function captureScope(): PublicationMutationScope {
    return {
      ...captureWorkspaceQueryScope(currentWorkspaceId()),
      publicationId: id,
    };
  }

  function scopeIsCurrent(scope: WorkspaceQueryScope): boolean {
    return workspaceQueryScopeIsCurrent(scope, getWorkspaceId());
  }

  function invalidate(
    scope: PublicationMutationScope,
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

  async function run(
    action: (scope: PublicationMutationScope) => Promise<unknown>,
    refresh: {
      activities: readonly PublicationActivity[];
      calendar?: boolean;
      haptic?: boolean;
    },
  ): Promise<boolean> {
    const scope = captureScope();
    setActionError(null);
    try {
      await action(scope);
      if (refresh.haptic && scopeIsCurrent(scope)) void successHaptic();
    } catch (err) {
      if (scopeIsCurrent(scope)) {
        setActionError(err instanceof Error ? err.message : "Action failed");
        void errorHaptic();
      }
      invalidate(scope, refresh);
      return false;
    }
    invalidate(scope, refresh);
    return scopeIsCurrent(scope);
  }

  const pub = publication.data;

  const reschedule = useMutation({
    mutationFn: async ({ scope, when }: RescheduleRequest) => {
      if (!pub) throw new Error("Not loaded");
      requireCurrentQuerySession(scope);
      const requestApi = api();
      const updated = await requestApi.PUT("/publications/{id}", {
        params: { path: { id: scope.publicationId } },
        body: {
          expected_revision: pub.revision ?? 0,
          scheduled_at: when.toISOString(),
        },
      });
      if (updated.error) {
        throw new Error(await errorMessage(updated.response, "Could not reschedule"));
      }
      requireCurrentQueryActor(scope);
      const revision = updated.data?.revision ?? (pub.revision ?? 0) + 1;
      const { error, response } = await requestApi.POST("/publications/{id}/schedule", {
        params: { path: { id: scope.publicationId } },
        body: { expected_revision: revision },
      });
      if (error) throw new Error(await errorMessage(response, "Could not schedule"));
      requireCurrentQueryActor(scope);
    },
    onSuccess: (_, { scope }) => {
      if (scopeIsCurrent(scope)) {
        setPickerStep(null);
        setNewDate(null);
        void successHaptic();
      }
      invalidate(scope, { activities: ["scheduled"], calendar: true });
    },
    onError: (err, { scope }) => {
      if (scopeIsCurrent(scope)) {
        setNewDate(null);
        setActionError(err.message);
        void errorHaptic();
      }
      invalidate(scope, { activities: ["scheduled"], calendar: true });
    },
  });

  if (publication.isPending && !pub) {
    return (
      <Screen style={styles.coldState}>
        <DelayedQueryPlaceholder
          pending
          shape="detail"
          offline={publication.fetchStatus === "paused"}
        />
      </Screen>
    );
  }

  if (!pub) {
    return (
      <Screen style={styles.coldState}>
        <InitialQueryError
          title="Could not load this post"
          message={
            publication.error instanceof Error ? publication.error.message : "Failed to load"
          }
          retry={() => void publication.refetch()}
          secondaryAction={{ label: "Go back", onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  const status = pub.status;
  const body = pub.source_text || pub.renditions?.find((rendition) => rendition.body)?.body || "";

  return (
    <Screen safeTop={false}>
      <Stack.Screen
        options={{
          title: "",
          headerTintColor: colors.onSurface,
          headerBackTitle: "Back",
        }}
      />
      <ScrollView
        contentContainerStyle={{
          gap: spacing.large,
          padding: spacing.large,
          paddingBottom: spacing.doubleExtraLarge + spacing.extraLarge,
        }}
      >
        {actionError ? (
          <BodyText accessibilityRole="alert" style={{ color: colors.error }}>
            {actionError}
          </BodyText>
        ) : null}
        {publication.isError ? (
          <QueryNotice
            message="Could not refresh this post. The current copy remains visible."
            retry={() => void publication.refetch()}
          />
        ) : null}
        {publication.fetchStatus === "paused" ? (
          <QueryNotice message="You are offline. The current post remains visible." offline />
        ) : null}

        <Card style={{ gap: spacing.small }}>
          <View style={[styles.headerRow, { gap: spacing.small }]}>
            <StatusBadge status={status} />
            {pub.scheduled_at ? <BodyText>{formatDateTime(pub.scheduled_at)}</BodyText> : null}
          </View>
          {pub.title ? (
            <Text
              accessibilityRole="header"
              style={[typography.titleLarge, { color: colors.onSurface }]}
            >
              {pub.title}
            </Text>
          ) : null}
          {body ? (
            <BodyText selectable style={{ color: colors.onSurface }}>
              {body}
            </BodyText>
          ) : null}
        </Card>

        <SectionHeader label={`Destinations · ${pub.renditions?.length ?? 0}`} />
        <View style={{ gap: spacing.small }}>
          {(pub.renditions ?? []).map((rendition) => (
            <Card key={rendition.id}>
              <View style={styles.renditionRow}>
                <View
                  style={[
                    styles.platformDot,
                    {
                      backgroundColor: statusColor(
                        rendition.status ?? "draft",
                        colors.status,
                        colors.onSurfaceVariant,
                      ),
                    },
                  ]}
                />
                <View style={{ flex: 1, gap: spacing.extraSmall }}>
                  <Text style={[typography.bodyLarge, { color: colors.onSurface }]}>
                    {platformLabel(rendition.platform ?? "")}
                    {rendition.target_key ? ` · ${rendition.target_key}` : ""}
                  </Text>
                  <StatusBadge status={rendition.status ?? "draft"} />
                </View>
              </View>
              {rendition.body && rendition.body !== body ? (
                <BodyText selectable style={{ marginTop: 8 }}>
                  {rendition.body}
                </BodyText>
              ) : null}
              {rendition.error_message ? (
                <BodyText style={{ color: colors.error, marginTop: 8 }} selectable>
                  {rendition.error_message}
                  {rendition.error_retry_at
                    ? `\nRetrying ${formatDateTime(rendition.error_retry_at)}`
                    : ""}
                </BodyText>
              ) : null}
              {rendition.external_url ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(rendition.external_url!)}
                  style={styles.externalLink}
                >
                  <Text style={[typography.labelLarge, { color: colors.primary }]}>
                    View published post
                  </Text>
                </Pressable>
              ) : null}
            </Card>
          ))}
        </View>

        <SectionHeader label="Actions" />
        <View style={{ gap: spacing.small }}>
          {status === "draft" || status === "ready" ? (
            <>
              <Button
                title="Edit"
                intent="primary"
                onPress={() => {
                  const scope = captureScope();
                  void prefetchPublicationEditor(
                    queryClient,
                    scope.workspaceId,
                    scope.publicationId,
                  );
                  router.push({
                    pathname: "/publications/[id]/edit",
                    params: { id: scope.publicationId },
                  });
                }}
              />
              {pub.scheduled_at ? (
                <Button
                  title="Schedule & queue"
                  intent="ordinary"
                  onPress={() =>
                    run(
                      async (scope) => {
                        const { error, response } = await api().POST(
                          "/publications/{id}/schedule",
                          {
                            params: { path: { id: scope.publicationId } },
                            body: { expected_revision: pub.revision ?? 0 },
                          },
                        );
                        if (error)
                          throw new Error(await errorMessage(response, "Could not schedule"));
                      },
                      { activities: ["draft", "scheduled"], calendar: true, haptic: true },
                    )
                  }
                />
              ) : null}
            </>
          ) : null}

          {status === "scheduled" ? (
            <>
              <Button
                title="Reschedule"
                intent="ordinary"
                onPress={() =>
                  setPickerStep((current) =>
                    current ? null : firstPickerStep(Platform.OS === "android" ? "android" : "ios"),
                  )
                }
              />
              <Button
                title="Cancel schedule"
                intent="destructive"
                onPress={() =>
                  run(
                    async (scope) => {
                      const { error, response } = await api().POST("/publications/{id}/cancel", {
                        params: { path: { id: scope.publicationId } },
                        body: { expected_revision: pub.revision ?? 0 },
                      });
                      if (error) throw new Error(await errorMessage(response, "Could not cancel"));
                    },
                    { activities: ["draft", "scheduled"], calendar: true, haptic: true },
                  )
                }
              />
            </>
          ) : null}

          {status === "failed" ? (
            <>
              <Button
                title="Retry failed destinations"
                intent="primary"
                onPress={() =>
                  run(
                    async (scope) => {
                      const { error, response } = await api().POST(
                        "/publications/{id}/retry-failed",
                        {
                          params: { path: { id: scope.publicationId } },
                        },
                      );
                      if (error) throw new Error(await errorMessage(response, "Could not retry"));
                    },
                    { activities: ["failed", "scheduled"], calendar: true, haptic: true },
                  )
                }
              />
              <Button
                title={
                  pub.failure_dismissed_at ? "Restore in failed posts" : "Dismiss from failed posts"
                }
                intent="quiet"
                onPress={() =>
                  run(
                    async (scope) => {
                      const result = pub.failure_dismissed_at
                        ? await api().DELETE("/publications/{id}/failure-dismissal", {
                            params: { path: { id: scope.publicationId } },
                          })
                        : await api().POST("/publications/{id}/failure-dismissal", {
                            params: { path: { id: scope.publicationId } },
                          });
                      if (result.error)
                        throw new Error(
                          await errorMessage(result.response, "Could not update failed post"),
                        );
                    },
                    { activities: ["failed"], haptic: true },
                  )
                }
              />
            </>
          ) : null}

          {(status === "failed" || status === "scheduled") && pub.revision !== undefined ? (
            <Button
              title="Delete post"
              intent="destructive"
              onPress={() =>
                Alert.alert("Delete post?", "This removes it from the queue permanently.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => {
                      void (async () => {
                        const deleted = await run(
                          async (scope) => {
                            const { error, response } = await api().DELETE("/publications/{id}", {
                              params: {
                                path: { id: scope.publicationId },
                                query: {
                                  confirm: true,
                                  expected_revision: pub.revision!,
                                },
                              },
                            });
                            if (error)
                              throw new Error(await errorMessage(response, "Could not delete"));
                          },
                          {
                            activities: [status === "scheduled" ? "scheduled" : "failed"],
                            calendar: status === "scheduled",
                          },
                        );
                        if (deleted) router.back();
                      })();
                    },
                  },
                ])
              }
            />
          ) : null}

          {status === "published" ? (
            <BodyText style={{ textAlign: "center" }}>
              Published. Open a destination above to see the live post.
            </BodyText>
          ) : null}
        </View>

        {pickerStep && status === "scheduled" ? (
          <Card style={{ marginTop: spacing.medium, gap: spacing.small }}>
            <DateTimePicker
              value={newDate ?? (pub.scheduled_at ? new Date(pub.scheduled_at) : nextHour())}
              mode={pickerStep}
              onChange={(event, date) => {
                if (event.type !== "set" || !date) {
                  setPickerStep(null);
                  return;
                }
                const result = applyPickerValue(
                  newDate ?? (pub.scheduled_at ? new Date(pub.scheduled_at) : nextHour()),
                  date,
                  pickerStep,
                );
                setNewDate(result.value);
                setPickerStep(result.nextStep);
                if (!result.nextStep) {
                  reschedule.mutate({ scope: captureScope(), when: result.value });
                }
              }}
            />
            {reschedule.isPending ? <ActivityIndicator color={colors.primary} /> : null}
            {newDate && reschedule.isPending ? (
              <BodyText>Moving to {formatDateTime(newDate.toISOString())}...</BodyText>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function nextHour(): Date {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return date;
}

const styles = StyleSheet.create({
  coldState: {
    paddingHorizontal: 20,
    paddingTop: 72,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  renditionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  platformDot: {
    width: 8,
    height: 32,
    borderRadius: 4,
  },
  externalLink: {
    minHeight: 48,
    justifyContent: "center",
    marginTop: 4,
  },
});
