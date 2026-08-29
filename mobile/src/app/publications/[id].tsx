import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

import {
  BodyText,
  Button,
  Card,
  Screen,
  StatusBadge,
  SectionHeader,
  useColors,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { applyPickerValue, firstPickerStep, type PickerStep } from "@/lib/date-time-picker";
import { formatDateTime, platformLabel, statusColor } from "@/lib/format";
import { errorHaptic, successHaptic } from "@/lib/haptics";

export default function PostScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [pickerStep, setPickerStep] = useState<PickerStep | null>(null);
  const [newDate, setNewDate] = useState<Date | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const publication = useQuery({
    queryKey: ["publication", id],
    queryFn: async () => {
      const { data, error, response } = await api().GET("/publications/{id}", {
        params: { path: { id } },
      });
      if (error || !data) throw new Error(await errorMessage(response, "Could not load post"));
      return data;
    },
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["publication", id] });
    void queryClient.invalidateQueries({ queryKey: ["publications"] });
    void queryClient.invalidateQueries({ queryKey: ["calendar"] });
  }

  async function run(action: () => Promise<unknown>, hapticOnSuccess = false): Promise<boolean> {
    setActionError(null);
    try {
      await action();
      if (hapticOnSuccess) {
        void successHaptic();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
      void errorHaptic();
      invalidate();
      return false;
    }
    invalidate();
    return true;
  }

  const pub = publication.data;

  const reschedule = useMutation({
    mutationFn: async (when: Date) => {
      if (!pub) throw new Error("Not loaded");
      const updated = await api().PUT("/publications/{id}", {
        params: { path: { id } },
        body: {
          expected_revision: pub.revision ?? 0,
          scheduled_at: when.toISOString(),
        },
      });
      if (updated.error) {
        throw new Error(await errorMessage(updated.response, "Could not reschedule"));
      }
      const revision = updated.data?.revision ?? (pub.revision ?? 0) + 1;
      const { error, response } = await api().POST("/publications/{id}/schedule", {
        params: { path: { id } },
        body: { expected_revision: revision },
      });
      if (error) throw new Error(await errorMessage(response, "Could not schedule"));
    },
    onSuccess: () => {
      setPickerStep(null);
      setNewDate(null);
      void successHaptic();
      invalidate();
    },
    onError: (err) => {
      setNewDate(null);
      setActionError(err.message);
      void errorHaptic();
    },
  });

  if (publication.isLoading) {
    return (
      <Screen style={{ alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.tint} />
      </Screen>
    );
  }

  if (publication.isError || !pub) {
    return (
      <Screen style={{ padding: 20, paddingTop: 100, gap: 12 }}>
        <BodyText style={{ color: colors.danger }}>
          {publication.error instanceof Error ? publication.error.message : "Failed to load"}
        </BodyText>
        <Button title="Go back" onPress={() => router.back()} />
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
          headerTintColor: colors.text,
          headerBackTitle: "Back",
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {actionError ? (
          <BodyText accessibilityRole="alert" style={{ color: colors.danger }}>
            {actionError}
          </BodyText>
        ) : null}

        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <StatusBadge status={status} />
            {pub.scheduled_at ? <BodyText>{formatDateTime(pub.scheduled_at)}</BodyText> : null}
          </View>
          {pub.title ? (
            <Text style={[styles.title, { color: colors.text }]}>{pub.title}</Text>
          ) : null}
          {body ? <BodyText selectable>{body}</BodyText> : null}
        </Card>

        <SectionHeader label={`Destinations · ${pub.renditions?.length ?? 0}`} />
        <View style={{ gap: 8 }}>
          {(pub.renditions ?? []).map((rendition) => (
            <Card key={rendition.id}>
              <View style={styles.renditionRow}>
                <View
                  style={[
                    styles.platformDot,
                    {
                      backgroundColor: statusColor(rendition.status ?? "draft", colors.dark),
                    },
                  ]}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 15,
                      fontWeight: "500",
                    }}
                  >
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
                <BodyText style={{ color: colors.danger, marginTop: 8 }} selectable>
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
                  <Text style={{ color: colors.tint, fontSize: 14 }}>View published post</Text>
                </Pressable>
              ) : null}
            </Card>
          ))}
        </View>

        <SectionHeader label="Actions" />
        <View style={styles.actions}>
          {status === "draft" || status === "ready" ? (
            <>
              <Button
                title="Edit"
                variant="filled"
                onPress={() => router.push({ pathname: "/publications/[id]/edit", params: { id } })}
              />
              {pub.scheduled_at ? (
                <Button
                  title="Schedule & queue"
                  variant="tinted"
                  onPress={() =>
                    run(async () => {
                      const { error, response } = await api().POST("/publications/{id}/schedule", {
                        params: { path: { id } },
                        body: { expected_revision: pub.revision ?? 0 },
                      });
                      if (error)
                        throw new Error(await errorMessage(response, "Could not schedule"));
                    }, true)
                  }
                />
              ) : null}
            </>
          ) : null}

          {status === "scheduled" ? (
            <>
              <Button
                title="Reschedule"
                variant="tinted"
                onPress={() =>
                  setPickerStep((current) =>
                    current ? null : firstPickerStep(Platform.OS === "android" ? "android" : "ios"),
                  )
                }
              />
              <Button
                title="Cancel schedule"
                variant="destructive"
                onPress={() =>
                  run(async () => {
                    const { error, response } = await api().POST("/publications/{id}/cancel", {
                      params: { path: { id } },
                      body: { expected_revision: pub.revision ?? 0 },
                    });
                    if (error) throw new Error(await errorMessage(response, "Could not cancel"));
                  }, true)
                }
              />
            </>
          ) : null}

          {status === "failed" ? (
            <>
              <Button
                title="Retry failed destinations"
                variant="filled"
                onPress={() =>
                  run(async () => {
                    const { error, response } = await api().POST(
                      "/publications/{id}/retry-failed",
                      {
                        params: { path: { id } },
                      },
                    );
                    if (error) throw new Error(await errorMessage(response, "Could not retry"));
                  }, true)
                }
              />
              <Button
                title={
                  pub.failure_dismissed_at ? "Restore in failed posts" : "Dismiss from failed posts"
                }
                variant="plain"
                onPress={() =>
                  run(async () => {
                    const result = pub.failure_dismissed_at
                      ? await api().DELETE("/publications/{id}/failure-dismissal", {
                          params: { path: { id } },
                        })
                      : await api().POST("/publications/{id}/failure-dismissal", {
                          params: { path: { id } },
                        });
                    if (result.error)
                      throw new Error(
                        await errorMessage(result.response, "Could not update failed post"),
                      );
                  }, true)
                }
              />
            </>
          ) : null}

          {(status === "failed" || status === "scheduled") && pub.revision !== undefined ? (
            <Button
              title="Delete post"
              variant="destructive"
              onPress={() =>
                Alert.alert("Delete post?", "This removes it from the queue permanently.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => {
                      void (async () => {
                        const deleted = await run(async () => {
                          const { error, response } = await api().DELETE("/publications/{id}", {
                            params: {
                              path: { id },
                              query: {
                                confirm: true,
                                expected_revision: pub.revision!,
                              },
                            },
                          });
                          if (error)
                            throw new Error(await errorMessage(response, "Could not delete"));
                        });
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
          <Card style={{ marginTop: 12, gap: 10 }}>
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
                  reschedule.mutate(result.value);
                }
              }}
            />
            {reschedule.isPending ? <ActivityIndicator color={colors.tint} /> : null}
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
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 60,
  },
  headerCard: {
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
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
  actions: {
    gap: 10,
  },
  externalLink: {
    minHeight: 48,
    justifyContent: "center",
    marginTop: 4,
  },
});
