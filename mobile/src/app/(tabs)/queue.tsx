import { router, Stack } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useState } from "react";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";

import { BodyText, Button, Card, Screen, StatusBadge, useColors } from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { formatDateTime, platformLabel, relativeTime } from "@/lib/format";
import { errorHaptic, selectionHaptic, successHaptic } from "@/lib/haptics";
import { usePublications, type PublicationListItem } from "@/lib/queries";

export default function QueueScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<PublicationListItem | null>(null);

  const scheduled = usePublications("scheduled");
  const failed = usePublications("failed");

  const retryFailed = useMutation({
    mutationFn: async (publicationId: string) => {
      const { error, response } = await api().POST("/publications/{id}/retry-failed", {
        params: { path: { id: publicationId } },
      });
      if (error) throw new Error(await errorMessage(response, "Retry failed"));
    },
    onSuccess: () => {
      void successHaptic();
      void queryClient.invalidateQueries({ queryKey: ["publications"] });
    },
    onError: (err) => {
      setActionError(err.message);
      void errorHaptic();
    },
  });

  const dismissFailed = useMutation({
    mutationFn: async (publication: PublicationListItem) => {
      const { error, response } = await api().POST("/publications/{id}/failure-dismissal", {
        params: { path: { id: publication.id } },
      });
      if (error) throw new Error(await errorMessage(response, "Could not dismiss failed post"));
      return publication;
    },
    onSuccess: (publication) => {
      setDismissed(publication);
      setActionError(null);
      void selectionHaptic();
      void queryClient.invalidateQueries({ queryKey: ["publications"] });
    },
    onError: (err) => {
      setActionError(err.message);
      void errorHaptic();
    },
  });

  const restoreFailed = useMutation({
    mutationFn: async (publicationId: string) => {
      const { error, response } = await api().DELETE("/publications/{id}/failure-dismissal", {
        params: { path: { id: publicationId } },
      });
      if (error) throw new Error(await errorMessage(response, "Could not restore failed post"));
    },
    onSuccess: () => {
      setDismissed(null);
      void queryClient.invalidateQueries({ queryKey: ["publications"] });
    },
    onError: (err) => {
      setActionError(err.message);
      void errorHaptic();
    },
  });

  const refreshing = scheduled.isRefetching || failed.isRefetching;

  function refresh() {
    void scheduled.refetch();
    void failed.refetch();
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Queue</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textSecondary}
          />
        }
      >
        {scheduled.isLoading || failed.isLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.tint} />
        ) : null}
        {actionError ? (
          <BodyText accessibilityRole="alert" style={{ color: colors.danger, marginBottom: 8 }}>
            {actionError}
          </BodyText>
        ) : null}

        <Section title="Failed" count={failed.data?.length ?? 0}>
          {failed.isError ? <QueryError query={failed} label="failed posts" /> : null}
          {(failed.data ?? []).map((publication) => (
            <FailedCard
              key={publication.id}
              publication={publication}
              onRetry={() => retryFailed.mutate(publication.id)}
              onDismiss={() => dismissFailed.mutate(publication)}
              pending={retryFailed.isPending && retryFailed.variables === publication.id}
            />
          ))}
          {(failed.data?.length ?? 0) === 0 && !failed.isLoading && !failed.isError ? (
            <Card>
              <BodyText style={{ textAlign: "center" }}>No failed posts.</BodyText>
            </Card>
          ) : null}
        </Section>

        <Section title="Upcoming" count={scheduled.data?.length ?? 0}>
          {scheduled.isError ? <QueryError query={scheduled} label="scheduled posts" /> : null}
          {(scheduled.data ?? []).map((publication) => (
            <QueueRow key={publication.id} publication={publication} />
          ))}
          {(scheduled.data?.length ?? 0) === 0 && !scheduled.isLoading && !scheduled.isError ? (
            <Card>
              <BodyText style={{ textAlign: "center" }}>Nothing scheduled yet.</BodyText>
            </Card>
          ) : null}
        </Section>
      </ScrollView>
      {dismissed ? (
        <View style={[styles.undoBar, { backgroundColor: colors.text }]} accessibilityRole="alert">
          <Text style={{ color: colors.bg, flex: 1 }}>Failed post dismissed</Text>
          <Button
            title="Undo"
            variant="plain"
            onPress={() => restoreFailed.mutate(dismissed.id)}
            loading={restoreFailed.isPending}
            style={styles.undoButton}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function QueryError({
  query,
  label,
}: {
  query: { error: Error | null; refetch: () => unknown };
  label: string;
}) {
  const colors = useColors();
  return (
    <Card style={styles.error}>
      <Text style={[styles.errorTitle, { color: colors.text }]}>Could not load {label}</Text>
      <BodyText accessibilityRole="alert">
        {query.error?.message ?? "Check your connection and try again."}
      </BodyText>
      <Button title="Try again" variant="tinted" onPress={() => void query.refetch()} />
    </Card>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
        {title.toUpperCase()}
        {count > 0 ? ` · ${count}` : ""}
      </Text>
      {children}
    </View>
  );
}

function QueueRow({ publication }: { publication: PublicationListItem }) {
  const colors = useColors();
  const platforms = distinctPlatforms(publication);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({ pathname: "/publications/[id]", params: { id: publication.id } })
      }
    >
      {({ pressed }) => (
        <Card style={[styles.row, pressed && { opacity: 0.6 }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={2}>
              {titleFor(publication)}
            </Text>
            <BodyText>
              {formatDateTime(publication.scheduled_at)}
              {platforms.length > 0 ? ` · ${platforms.join(", ")}` : ""}
            </BodyText>
          </View>
          <StatusBadge status={publication.status} />
        </Card>
      )}
    </Pressable>
  );
}

function FailedCard({
  publication,
  onRetry,
  onDismiss,
  pending,
}: {
  publication: PublicationListItem;
  onRetry: () => void;
  onDismiss: () => void;
  pending: boolean;
}) {
  const colors = useColors();
  const errors = (publication.renditions ?? [])
    .filter((rendition) => rendition.status === "failed")
    .map((rendition) => ({
      platform: rendition.platform,
      message: rendition.error_message,
    }));
  return (
    <Swipeable
      friction={1.6}
      leftThreshold={72}
      overshootLeft={false}
      renderLeftActions={() => (
        <View style={[styles.swipeAction, { backgroundColor: colors.success }]}>
          <Text style={styles.swipeActionText}>Dismiss</Text>
        </View>
      )}
      onSwipeableOpen={onDismiss}
    >
      <Card style={styles.row}>
        <Pressable
          accessibilityRole="button"
          style={{ flex: 1 }}
          onPress={() =>
            router.push({
              pathname: "/publications/[id]",
              params: { id: publication.id },
            })
          }
        >
          <View style={{ gap: 6 }}>
            <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={2}>
              {titleFor(publication)}
            </Text>
            <StatusBadge status="failed" />
            {errors.slice(0, 2).map((error, index) => (
              <BodyText key={index} numberOfLines={2}>
                {error.platform ? `${platformLabel(error.platform)}: ` : ""}
                {error.message ?? "Publication failed"}
              </BodyText>
            ))}
            <BodyText>{relativeTime(publication.updated_at)}</BodyText>
          </View>
        </Pressable>
        <View style={styles.failedActions}>
          <Button
            title="Retry"
            variant="tinted"
            onPress={onRetry}
            disabled={pending}
            loading={pending}
            style={styles.retryButton}
          />
          <Button title="Dismiss" variant="plain" onPress={onDismiss} />
        </View>
      </Card>
    </Swipeable>
  );
}

function titleFor(publication: PublicationListItem): string {
  if (publication.title) return publication.title;
  for (const rendition of publication.renditions ?? []) {
    if (rendition.body) return rendition.body.split("\n")[0];
  }
  return "Untitled";
}

function distinctPlatforms(publication: PublicationListItem): string[] {
  const platforms = new Set<string>();
  for (const rendition of publication.renditions ?? []) {
    if (rendition.platform) platforms.add(platformLabel(rendition.platform));
  }
  return [...platforms].slice(0, 4);
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    marginHorizontal: 4,
  },
  content: {
    padding: 20,
    gap: 20,
    paddingBottom: 40,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "500",
  },
  retryButton: {
    paddingHorizontal: 12,
  },
  failedActions: {
    alignItems: "stretch",
    gap: 2,
  },
  swipeAction: {
    alignItems: "flex-start",
    borderRadius: 12,
    justifyContent: "center",
    paddingHorizontal: 20,
    width: 112,
  },
  swipeActionText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  undoBar: {
    alignItems: "center",
    borderRadius: 14,
    bottom: 18,
    flexDirection: "row",
    left: 20,
    paddingLeft: 16,
    position: "absolute",
    right: 20,
  },
  undoButton: {
    minHeight: 48,
  },
  error: {
    gap: 12,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
});
