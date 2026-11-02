import { NativeText } from "@/components/native-text";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import * as WebBrowser from "expo-web-browser";

import { inboxSummaryQueryOptions } from "@openpost/query-catalog";
import { DitherPanel } from "@/components/dither-panel";
import { PublicationRow } from "@/components/publication-row";
import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";
import { ThemeIcon } from "@/components/theme-icon";
import { WorkspaceHeader } from "@/components/workspace-header";
import { BodyText, ContentSection, ContentTitle, Screen } from "@/components/ui";
import { getServer } from "@/lib/server";
import { mobileInboxAPI } from "@/lib/inbox/api";
import {
  HOME_GOING_OUT_LIMIT,
  HOME_HORIZON_DAYS,
  homeClosureLine,
  homeNeedsYouRows,
  homeScheduledPosts,
  homeStatusSentence,
  homeTodayCount,
  type HomeNeedsYouKind,
} from "@/lib/home-overview";
import {
  useCalendarPublications,
  useDisconnectedAccounts,
  useFailedJobs,
  useWorkspaceCapabilities,
  useWorkspaceId,
  useWorkspaceSetup,
} from "@/lib/queries";
import { useNativeTheme } from "@/theme";

function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function goingOutTime(occurrence: Date): string {
  return occurrence.toLocaleString("en", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Setup steps keep the web labels; steps the app cannot own open the web app. */
const SETUP_STEP_LABELS: Record<string, string> = {
  workspace: "Name your workspace",
  subscription: "Plan",
  destination: "Connect an account",
  composition: "Write something",
  publication: "Publish a post",
};

function setupStepOpensComposer(stepId: string): boolean {
  return stepId === "composition" || stepId === "publication";
}

function setupStepWebPath(stepId: string): string {
  if (stepId === "workspace") return "/settings?tab=general#workspace-name";
  if (stepId === "destination") return "/accounts";
  return "/settings?tab=plan";
}

export default function HomeScreen() {
  const workspaceId = useWorkspaceId();
  const { colors, spacing, typography, shape } = useNativeTheme().manifest;
  const today = useMemo(() => new Date(), []);
  // Day-granular bounds keep the query key stable between renders.
  const from = useMemo(() => startOfDay(today), [today]);
  const before = useMemo(() => new Date(from.getTime() + HOME_HORIZON_DAYS * 86400000), [from]);
  const scheduled = useCalendarPublications(from.toISOString(), before.toISOString());
  const failed = useFailedJobs(5);
  const disconnected = useDisconnectedAccounts();
  const setup = useWorkspaceSetup();
  const canEdit = useWorkspaceCapabilities()?.can_edit === true;
  const inboxSummary = useQuery(inboxSummaryQueryOptions(mobileInboxAPI, workspaceId ?? ""));

  const hasSchedule = scheduled.data !== undefined;
  const posts = useMemo(() => homeScheduledPosts(scheduled.data ?? []), [scheduled.data]);
  const goingOut = posts.slice(0, HOME_GOING_OUT_LIMIT);
  const todayCount = homeTodayCount(posts, today);
  const status = homeStatusSentence({
    todayCount,
    nextOccurrence: posts[0]?.occurrence ?? null,
  });
  const closure = homeClosureLine({ lastOccurrence: posts.at(-1)?.occurrence ?? null, today });

  const needsYou = homeNeedsYouRows({
    failed: failed.data?.total ?? 0,
    unreadReplies: inboxSummary.data?.unread_comments ?? 0,
    unreadMessages: inboxSummary.data?.unread_conversations ?? 0,
    disconnected,
  });

  const setupSteps = setup.data?.visible ? (setup.data.steps ?? []) : [];
  const pendingSetup = setupSteps.filter((step) => !step.completed);
  const completedSetup = setupSteps.filter((step) => step.completed);

  const coldPending = !hasSchedule && scheduled.isPending;

  async function openWebApp(path: string) {
    const server = getServer();
    if (!server) return;
    const url = new URL(path, server.baseUrl);
    try {
      await WebBrowser.openBrowserAsync(url.toString());
    } catch {
      // The web app surface owns its own errors; the tab keeps showing Home.
    }
  }

  function openNeedsYou(kind: HomeNeedsYouKind) {
    if (kind === "failed") router.push({ pathname: "/(tabs)/posts", params: { view: "queue" } });
    else if (kind === "disconnected") void openWebApp("/accounts");
    else router.push("/(tabs)/inbox");
  }

  function openSetupStep(stepId: string) {
    if (setupStepOpensComposer(stepId)) router.push("/drafts");
    else void openWebApp(setupStepWebPath(stepId));
  }

  return (
    <Screen>
      <WorkspaceHeader />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.large,
          paddingTop: spacing.small,
          paddingBottom: spacing.doubleExtraLarge + spacing.large,
          gap: spacing.large,
        }}
        refreshControl={
          <RefreshControl
            refreshing={scheduled.isRefetching}
            onRefresh={() => {
              void scheduled.refetch();
              void failed.refetch();
              void setup.refetch();
              void inboxSummary.refetch();
            }}
            tintColor={colors.onSurfaceVariant}
          />
        }
      >
        <DelayedQueryPlaceholder
          pending={coldPending}
          shape="list"
          offline={scheduled.fetchStatus === "paused"}
        />
        {scheduled.isError && !hasSchedule ? (
          <InitialQueryError
            title="Could not load Home"
            message={
              scheduled.error instanceof Error
                ? scheduled.error.message
                : "Check your connection and try again."
            }
            retry={() => void scheduled.refetch()}
          />
        ) : null}
        {scheduled.isError && hasSchedule ? (
          <QueryNotice
            message="Could not refresh Home. Current dates remain visible."
            retry={() => void scheduled.refetch()}
          />
        ) : null}
        {hasSchedule && scheduled.fetchStatus === "paused" ? (
          <QueryNotice message="You are offline. Current dates remain visible." offline />
        ) : null}

        {hasSchedule ? (
          <DitherPanel style={{ paddingHorizontal: spacing.large, paddingVertical: spacing.large }}>
            <NativeText
              accessibilityRole="header"
              style={[typography.headlineLarge, { color: colors.onSurface }]}
            >
              {status}
            </NativeText>
          </DitherPanel>
        ) : null}

        {pendingSetup.length > 0 ? (
          <ContentSection>
            <BodyText>
              {setup.data?.completed_steps ?? 0} of {setup.data?.total_steps ?? pendingSetup.length}{" "}
              complete
            </BodyText>
            <ContentTitle>Finish setting up this Workspace</ContentTitle>
            <View style={{ gap: spacing.small }}>
              {pendingSetup.map((step, index) => (
                <Pressable
                  key={step.id}
                  accessibilityRole="button"
                  accessibilityLabel={SETUP_STEP_LABELS[step.id] ?? step.id}
                  onPress={() => openSetupStep(step.id)}
                  style={({ pressed }) => [styles.stepRow, pressed && { opacity: 0.6 }]}
                >
                  <View style={[styles.stepBadge, { backgroundColor: colors.primary }]}>
                    <NativeText style={[typography.labelMedium, { color: colors.onPrimary }]}>
                      {index + 1}
                    </NativeText>
                  </View>
                  <BodyText>{SETUP_STEP_LABELS[step.id] ?? step.id}</BodyText>
                  <ThemeIcon role="disclosure" size={16} tintColor={colors.onSurfaceVariant} />
                </Pressable>
              ))}
              {completedSetup.map((step) => (
                <View key={step.id} style={[styles.stepRow, { opacity: 0.7 }]}>
                  <View style={[styles.stepBadge, { backgroundColor: colors.success }]}>
                    <ThemeIcon role="check" size={12} tintColor={colors.onSuccess} />
                  </View>
                  <BodyText>{SETUP_STEP_LABELS[step.id] ?? step.id}</BodyText>
                </View>
              ))}
            </View>
          </ContentSection>
        ) : null}

        {hasSchedule && goingOut.length > 0 ? (
          <ContentSection>
            <ContentTitle>Going out</ContentTitle>
            {goingOut.map((post) => (
              <PublicationRow
                key={post.id}
                publication={post.publication}
                detail={goingOutTime(post.occurrence)}
                onPress={() =>
                  router.push({ pathname: "/publications/[id]", params: { id: post.id } })
                }
              />
            ))}
          </ContentSection>
        ) : null}

        {needsYou.length > 0 ? (
          <ContentSection>
            <ContentTitle>Needs you</ContentTitle>
            {needsYou.map((row) => (
              <Pressable
                key={row.kind}
                accessibilityRole="button"
                accessibilityLabel={row.label}
                onPress={() => openNeedsYou(row.kind)}
                style={({ pressed }) => [
                  styles.needsRow,
                  { borderBottomColor: colors.outlineVariant, borderRadius: shape.medium },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <BodyText style={{ flex: 1 }}>{row.label}</BodyText>
                <ThemeIcon role="disclosure" size={16} tintColor={colors.onSurfaceVariant} />
              </Pressable>
            ))}
          </ContentSection>
        ) : null}

        {closure ? (
          <BodyText>{closure}</BodyText>
        ) : hasSchedule && posts.length === 0 && canEdit ? (
          <BodyText>Write a post and pick a time. OpenPost handles the rest.</BodyText>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  needsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
