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

import {
  BodyText,
  Button,
  Card,
  ContentTitle,
  PageTitle,
  Screen,
  StatusBadge,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { formatDateTime, platformLabel, relativeTime } from "@/lib/format";
import { errorHaptic, selectionHaptic, successHaptic } from "@/lib/haptics";
import { usePublications, type PublicationListItem } from "@/lib/queries";
import { useNativeTheme } from "@/theme";

export default function QueueScreen() {
  const theme = useNativeTheme();
  const { colors, shape, spacing, typography } = theme.manifest;
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
      <View
        style={{
          paddingBottom: spacing.small,
          paddingHorizontal: spacing.extraLarge,
          paddingTop: spacing.large,
        }}
      >
        <PageTitle>Queue</PageTitle>
      </View>

      <ScrollView
        contentContainerStyle={{
          gap: spacing.extraLarge,
          padding: spacing.extraLarge,
          paddingBottom: spacing.doubleExtraLarge + spacing.small,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.onSurfaceVariant}
          />
        }
      >
        {scheduled.isLoading || failed.isLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
        ) : null}
        {actionError ? (
          <BodyText
            accessibilityRole="alert"
            style={{ color: colors.error, marginBottom: spacing.small }}
          >
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
        <View
          style={[
            styles.undoBar,
            {
              backgroundColor: colors.onSurface,
              borderRadius: shape.medium,
              bottom: spacing.large,
              left: spacing.extraLarge,
              paddingLeft: spacing.large,
              right: spacing.extraLarge,
            },
          ]}
          accessibilityRole="alert"
        >
          <Text style={[typography.bodyMedium, { color: colors.background, flex: 1 }]}>
            Failed post dismissed
          </Text>
          <Button
            title="Undo"
            intent="quiet"
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
  return (
    <Card style={styles.error}>
      <ContentTitle>Could not load {label}</ContentTitle>
      <BodyText accessibilityRole="alert">
        {query.error?.message ?? "Check your connection and try again."}
      </BodyText>
      <Button title="Try again" intent="ordinary" onPress={() => void query.refetch()} />
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
  const theme = useNativeTheme();
  const { colors, spacing, typography } = theme.manifest;
  return (
    <View style={{ gap: spacing.small }}>
      <Text
        accessibilityRole="header"
        style={[
          typography.labelMedium,
          {
            color: colors.onSurfaceVariant,
            marginHorizontal: spacing.extraSmall,
          },
        ]}
      >
        {title.toUpperCase()}
        {count > 0 ? ` · ${count}` : ""}
      </Text>
      {children}
    </View>
  );
}

function QueueRow({ publication }: { publication: PublicationListItem }) {
  const theme = useNativeTheme();
  const { colors, spacing, typography } = theme.manifest;
  const platforms = distinctPlatforms(publication);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: "/publications/[id]",
          params: { id: publication.id },
        })
      }
    >
      {({ pressed }) => (
        <Card
          style={[
            styles.row,
            { gap: spacing.medium, paddingVertical: spacing.large },
            pressed && { opacity: 0.6 },
          ]}
        >
          <View style={{ flex: 1, gap: spacing.extraSmall }}>
            <Text style={[typography.bodyLarge, { color: colors.onSurface }]} numberOfLines={2}>
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
  const theme = useNativeTheme();
  const { colors, shape, spacing, typography } = theme.manifest;
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
        <View
          style={[
            styles.swipeAction,
            {
              backgroundColor: colors.success,
              borderRadius: shape.medium,
              paddingHorizontal: spacing.extraLarge,
            },
          ]}
        >
          <Text style={[typography.labelLarge, { color: colors.onSuccess }]}>Dismiss</Text>
        </View>
      )}
      onSwipeableOpen={onDismiss}
    >
      <Card style={[styles.row, { gap: spacing.medium, paddingVertical: spacing.large }]}>
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
          <View style={{ gap: spacing.small }}>
            <Text style={[typography.bodyLarge, { color: colors.onSurface }]} numberOfLines={2}>
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
        <View style={[styles.failedActions, { gap: spacing.extraSmall }]}>
          <Button
            title="Retry"
            intent="ordinary"
            onPress={onRetry}
            disabled={pending}
            loading={pending}
            style={styles.retryButton}
          />
          <Button title="Dismiss" intent="quiet" onPress={onDismiss} />
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
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  retryButton: {
    paddingHorizontal: 12,
  },
  failedActions: {
    alignItems: "stretch",
  },
  swipeAction: {
    alignItems: "flex-start",
    justifyContent: "center",
    width: 112,
  },
  undoBar: {
    alignItems: "center",
    flexDirection: "row",
    position: "absolute",
  },
  undoButton: {
    minHeight: 48,
  },
  error: {
    gap: 12,
  },
});
