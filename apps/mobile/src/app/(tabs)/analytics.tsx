import { DitherPressable } from "@/components/dither-pressable";
import { NativeText as Text } from "@/components/native-text";
import {
  analyticsCalendarPresetRange,
  type AnalyticsSort,
  type AnalyticsOverview,
  type AnalyticsRangeDays,
} from "@openpost/query-catalog";
import { gradientSvg } from "@openpost/dither/paint";
import {
  analyticsCalendarDate as calendarDate,
  analyticsPickerDate,
} from "@/lib/analytics-date-range";
import DateTimePicker from "@react-native-community/datetimepicker";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { getServer } from "@/lib/server";
import {
  AnalyticsAccountPerformance,
  AnalyticsCoverage,
  AnalyticsPostResult,
  AnalyticsTakeaways,
  type AnalyticsPost,
} from "@/components/analytics-results";
import { useState } from "react";
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { SvgXml } from "react-native-svg";

import { BottomDrawer } from "@/components/bottom-drawer";
import { AccountAvatar } from "@/components/account-avatar";
import { trendBars } from "@/lib/analytics-chart";
import { DitherPanel } from "@/components/dither-panel";
import { PlatformIcon } from "@/components/platform-icon";
import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";
import { BodyText, Button, ContentTitle, EmptyState, Screen } from "@/components/ui";
import { WorkspaceHeader } from "@/components/workspace-header";
import { analyticsAccountOptions } from "@/lib/analytics-accounts";
import { accountHandle, platformLabel } from "@/lib/format";
import { useAnalytics, useWorkspaceId, useWorkspaceCapabilities } from "@/lib/queries";
import { useNativeTheme } from "@/theme";

const RANGES: readonly AnalyticsRangeDays[] = [7, 30, 90, 365, 0];
const rangeLabel = (days: AnalyticsRangeDays) =>
  days === 0 ? "All time" : days === 365 ? "Last year" : `${days} days`;
const number = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export default function AnalyticsScreen() {
  const workspaceId = useWorkspaceId();
  return <AnalyticsDashboard key={workspaceId} />;
}

function AnalyticsDashboard() {
  const workspaceId = useWorkspaceId();
  const canRepurpose = useWorkspaceCapabilities()?.can_edit === true;
  const { colors, spacing, typography, shape } = useNativeTheme().manifest;
  const [days, setDays] = useState<AnalyticsRangeDays>(30);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [draftFrom, setDraftFrom] = useState(() =>
    calendarDate(new Date(Date.now() - 30 * 86400000)),
  );
  const [draftTo, setDraftTo] = useState(() => calendarDate(new Date()));
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const validRange = draftFrom <= draftTo && draftTo <= calendarDate(new Date());
  const [trend, setTrend] = useState<"visibility" | "engagement" | "followers">("visibility");
  const [sort, setSort] = useState<AnalyticsSort>("visibility");
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<AnalyticsPost | null>(null);
  const [actionError, setActionError] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const selectedRangeLabel = from && to ? `${from} – ${to}` : rangeLabel(days);
  const query = useAnalytics({ days, from, to, accountId, sort });
  const overview = query.data?.pages[0];
  // The filter offers exactly the accounts the overview describes, using the
  // same identity as the audience and post rows below.
  const { options: overviewAccounts, effectiveAccountId } = analyticsAccountOptions(
    overview
      ? [
          ...(overview.accounts ?? []),
          ...(overview.performance ?? [])
            .filter((item) => !overview.accounts?.some((account) => account.id === item.account_id))
            .map((item) => ({
              id: item.account_id,
              platform: item.platform,
              username: item.username,
              avatar_url: item.avatar_url,
              status: item.status,
            })),
        ]
      : undefined,
    accountId,
  );
  const selectedAccount = overviewAccounts.find((account) => account.id === effectiveAccountId);
  // A settled fresh overview that no longer describes the selected account
  // (it was revoked or removed) clears the filter. Adjusting state here is the
  // supported React pattern; a transient empty (loading), error, or
  // offline/paused response never clears the filter.
  if (
    accountId &&
    !effectiveAccountId &&
    overview &&
    !query.isPending &&
    !query.isError &&
    query.fetchStatus !== "paused"
  ) {
    setAccountId("");
  }
  const error = query.error instanceof Error ? query.error.message : "Try again.";
  function openPost(reference: AnalyticsPost["reference"]) {
    if (reference.publication_id)
      router.push({
        pathname: "/publications/[id]",
        params: { id: reference.publication_id },
      });
  }
  async function openWeb(path: string, params: Record<string, string>) {
    const server = getServer();
    if (!server) return;
    const url = new URL(path, server.baseUrl);
    for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
    try {
      await WebBrowser.openBrowserAsync(url.toString());
    } catch {
      setActionError("Could not open the web app. Try again.");
    }
  }
  const manageAccount = (id: string) =>
    void openWeb("/settings", {
      tab: "accounts",
      account_id: id,
      workspace_id: workspaceId ?? "",
    });
  const repurpose = (reference: AnalyticsPost["reference"]) =>
    void openWeb("/analytics", {
      repurpose_type: reference.type,
      repurpose_publication_id: reference.publication_id ?? "",
      repurpose_rendition_id: reference.rendition_id ?? "",
      workspace: workspaceId ?? "",
      days: String(days),
      from,
      to,
    });
  return (
    <Screen>
      <WorkspaceHeader />
      <View
        style={{
          paddingHorizontal: spacing.large,
          gap: spacing.small,
          paddingBottom: spacing.small,
        }}
      >
        <Button
          title={selectedRangeLabel}
          intent="ordinary"
          accessibilityHint="Choose the analytics date range"
          onPress={() => {
            setCustom(Boolean(from));
            setDraftFrom(from || calendarDate(new Date(Date.now() - 30 * 86400000)));
            setDraftTo(to || calendarDate(new Date()));
            setPicking(null);
            setRangeOpen(true);
          }}
        />
        <Button
          title={
            selectedAccount
              ? `${platformLabel(selectedAccount.platform)} · ${accountHandle(selectedAccount.username, platformLabel(selectedAccount.platform), selectedAccount.platform)}${selectedAccount.status === "inactive" ? " · Inactive" : ""}`
              : "All accounts"
          }
          intent="quiet"
          onPress={() => setAccountPickerOpen(true)}
          accessibilityHint="Filter analytics by account"
        />
      </View>
      <BottomDrawer open={rangeOpen} onDismiss={() => setRangeOpen(false)} title="Date range">
        <View style={{ gap: spacing.medium, padding: spacing.large }}>
          {!custom
            ? (["month_to_date", "last_month"] as const).map((preset) => (
                <Button
                  key={preset}
                  title={preset === "month_to_date" ? "Month to date" : "Last month"}
                  intent="ordinary"
                  onPress={() => {
                    const range = analyticsCalendarPresetRange(preset);
                    setDays(range.days);
                    setFrom(range.from);
                    setTo(range.to);
                    setRangeOpen(false);
                  }}
                />
              ))
            : null}
          {!custom &&
            RANGES.map((range) => (
              <Button
                key={range}
                title={rangeLabel(range)}
                intent={!from && days === range ? "primary" : "ordinary"}
                accessibilityState={{ selected: !from && days === range }}
                onPress={() => {
                  setDays(range);
                  setFrom("");
                  setTo("");
                  setRangeOpen(false);
                }}
              />
            ))}
          <Button
            title={custom ? "Back to presets" : "Custom range"}
            intent="ordinary"
            onPress={() => {
              setCustom(!custom);
              setPicking(null);
            }}
          />
          {custom ? (
            <>
              <BodyText>Choose inclusive dates in UTC.</BodyText>
              <Button
                title={`From: ${draftFrom}`}
                intent="ordinary"
                onPress={() => setPicking("from")}
              />
              <Button title={`To: ${draftTo}`} intent="ordinary" onPress={() => setPicking("to")} />
              {picking ? (
                <DateTimePicker
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  value={analyticsPickerDate(picking === "from" ? draftFrom : draftTo)}
                  timeZoneName="UTC"
                  maximumDate={new Date(`${calendarDate(new Date())}T23:59:59.999Z`)}
                  onChange={(event, date) => {
                    if (Platform.OS !== "ios") setPicking(null);
                    if (event.type === "set" && date) {
                      if (picking === "from") setDraftFrom(calendarDate(date));
                      else setDraftTo(calendarDate(date));
                    }
                  }}
                />
              ) : null}
              {!validRange ? (
                <BodyText>Choose an end date on or after the start date.</BodyText>
              ) : null}
              {picking && Platform.OS === "ios" ? (
                <Button title="Done" intent="ordinary" onPress={() => setPicking(null)} />
              ) : null}
              <Button
                title="Apply"
                disabled={!validRange}
                onPress={() => {
                  setDays(30);
                  setFrom(draftFrom);
                  setTo(draftTo);
                  setRangeOpen(false);
                }}
              />
            </>
          ) : null}
        </View>
      </BottomDrawer>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.large,
          paddingTop: spacing.small,
          paddingBottom: spacing.large,
          gap: spacing.large,
        }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={colors.onSurfaceVariant}
          />
        }
      >
        <DelayedQueryPlaceholder
          pending={!overview && query.isPending}
          shape="list"
          offline={query.fetchStatus === "paused"}
        />
        {query.isError ? (
          overview ? (
            <QueryNotice
              message="Could not refresh analytics. Saved results remain visible."
              retry={() => void query.refetch()}
            />
          ) : (
            <InitialQueryError
              title="Could not load analytics"
              message={error}
              retry={() => void query.refetch()}
            />
          )
        ) : null}
        {overview && query.fetchStatus === "paused" ? (
          <QueryNotice message="You are offline. Saved results remain visible." offline />
        ) : null}
        {overview ? (
          <>
            {actionError ? <BodyText accessibilityRole="alert">{actionError}</BodyText> : null}
            <AnalyticsTakeaways
              canRepurpose={canRepurpose}
              overview={overview}
              onOpen={openPost}
              onRestore={manageAccount}
              onRepurpose={repurpose}
            />
            <View style={styles.metrics}>
              <Metric
                label="Visibility"
                value={
                  overview.summary.visibility?.measured
                    ? number.format(overview.summary.visibility.value)
                    : "No data"
                }
                detail={`${overview.summary.visibility?.measured ?? 0} of ${overview.content_total} outputs measured`}
              />
              <Metric
                label="Posts"
                value={number.format(overview.publication_total)}
                detail={`${overview.summary.published} published ${overview.summary.published === 1 ? "output" : "outputs"}`}
              />
              <Metric
                label="Followers"
                value={
                  overview.summary.followers.measured
                    ? number.format(overview.summary.followers.value)
                    : "No data"
                }
                detail={`${overview.summary.followers.measured} of ${accountId ? 1 : (overview.accounts?.length ?? 0)} accounts`}
                delta={overview.summary.followers.delta}
              />
              <Metric
                label="Engagement"
                value={
                  overview.summary.engagement.measured
                    ? number.format(overview.summary.engagement.value)
                    : "No data"
                }
                detail={`${overview.summary.engagement.measured} of ${overview.content_total} outputs`}
              />
            </View>
            <BodyText>
              Posts published in {selectedRangeLabel.toLowerCase()}, with their saved lifetime
              outcomes.
            </BodyText>
            <Button
              title="What visibility includes"
              intent="quiet"
              onPress={() => setCoverageOpen(true)}
            />
            <View style={{ gap: spacing.small }}>
              <ContentTitle>Trends</ContentTitle>
              <View style={styles.actions}>
                {(["visibility", "engagement", "followers"] as const).map((metric) => (
                  <Button
                    key={metric}
                    title={metric[0].toUpperCase() + metric.slice(1)}
                    intent={trend === metric ? "primary" : "ordinary"}
                    accessibilityState={{ selected: trend === metric }}
                    onPress={() => setTrend(metric)}
                    style={styles.filter}
                  />
                ))}
              </View>
              <TrendChart
                points={overview.trends[trend] ?? []}
                metric={trend}
                measured={(overview.summary[trend]?.measured ?? 0) > 0}
              />
            </View>
            <AnalyticsAccountPerformance overview={overview} onSelect={setAccountId} />
            <View style={{ gap: spacing.small }}>
              <ContentTitle>Top posts</ContentTitle>
              <View style={styles.actions}>
                {(["visibility", "engagement", "newest"] as const).map((value) => (
                  <Button
                    key={value}
                    title={
                      value === "newest"
                        ? "Newest"
                        : value === "visibility"
                          ? "Visibility"
                          : "Engagement"
                    }
                    intent={sort === value ? "primary" : "ordinary"}
                    accessibilityState={{ selected: sort === value }}
                    onPress={() => setSort(value)}
                  />
                ))}
              </View>
              <BodyText>Ranked across every matching post, with each post shown once.</BodyText>
              {(overview.highlights ?? []).map((post, index) => (
                <AnalyticsPostResult
                  key={post.reference.rendition_id}
                  post={post}
                  rank={index + 1}
                  onInspect={setSelectedPost}
                />
              ))}
              {!overview.highlights?.length ? (
                <BodyText>No measured post results in this period.</BodyText>
              ) : null}
            </View>
            <View style={{ gap: spacing.small }}>
              <ContentTitle>All results</ContentTitle>
              {(overview.content?.length ?? 0) === 0 ? (
                <EmptyState title="No published posts in this period" />
              ) : (
                query.data?.pages
                  .flatMap((page) => page.content ?? [])
                  .map((post) => (
                    <AnalyticsPostResult
                      key={post.reference.rendition_id}
                      post={post}
                      onInspect={setSelectedPost}
                    />
                  ))
              )}
            </View>
            {query.hasNextPage ? (
              <Button
                title={query.isFetchingNextPage ? "Loading posts…" : "More posts"}
                disabled={query.isFetchingNextPage}
                onPress={() => void query.fetchNextPage()}
              />
            ) : null}
            {overview.last_synced_at ? (
              <BodyText>
                Last synced {new Date(overview.last_synced_at).toLocaleString("en")}
              </BodyText>
            ) : (
              <BodyText>Results use saved platform data.</BodyText>
            )}
          </>
        ) : null}
      </ScrollView>
      <BottomDrawer
        open={coverageOpen}
        onDismiss={() => setCoverageOpen(false)}
        title="Visibility coverage"
      >
        {overview ? (
          <View style={{ padding: spacing.large }}>
            <AnalyticsCoverage overview={overview} />
          </View>
        ) : null}
      </BottomDrawer>
      <BottomDrawer
        open={Boolean(selectedPost)}
        onDismiss={() => setSelectedPost(null)}
        title="Post results"
      >
        {selectedPost ? (
          <View style={{ padding: spacing.large, gap: spacing.medium }}>
            <ContentTitle>
              {selectedPost.title || selectedPost.excerpt || "Untitled post"}
            </ContentTitle>
            <BodyText>
              {platformLabel(selectedPost.platform)} · {selectedPost.username}
            </BodyText>
            {Object.entries(selectedPost.metrics).map(([metric, value]) => (
              <BodyText key={metric}>
                {metric.replaceAll("_", " ")}: {number.format(value)}
                {selectedPost.metric_metadata?.[metric]?.unit &&
                selectedPost.metric_metadata?.[metric].unit !== "count"
                  ? ` ${selectedPost.metric_metadata?.[metric].unit.replaceAll("_", " ")}`
                  : ""}
              </BodyText>
            ))}
            {!Object.keys(selectedPost.metrics).length ? (
              <BodyText>No platform measurements for this output.</BodyText>
            ) : null}
            {selectedPost.error_message ? <BodyText>{selectedPost.error_message}</BodyText> : null}
            <Button
              title="Open post"
              intent="ordinary"
              onPress={() => {
                setSelectedPost(null);
                openPost(selectedPost.reference);
              }}
            />
            {canRepurpose ? (
              <Button
                title="Repurpose in web app"
                intent="ordinary"
                onPress={() => repurpose(selectedPost.reference)}
              />
            ) : null}
            {selectedPost.external_url ? (
              <Button
                title="View original"
                intent="quiet"
                onPress={() => {
                  if (selectedPost.external_url)
                    void WebBrowser.openBrowserAsync(selectedPost.external_url).catch(() =>
                      setActionError("Could not open the original post."),
                    );
                }}
              />
            ) : null}
          </View>
        ) : null}
      </BottomDrawer>
      {accountPickerOpen ? (
        <BottomDrawer open title="Accounts" onDismiss={() => setAccountPickerOpen(false)}>
          {query.isError && !overview ? (
            <QueryNotice message="Could not load accounts." retry={() => void query.refetch()} />
          ) : null}
          <Button
            title="All accounts"
            intent={effectiveAccountId ? "ordinary" : "primary"}
            accessibilityState={{ selected: !effectiveAccountId }}
            onPress={() => {
              setAccountId("");
              setAccountPickerOpen(false);
            }}
          />
          {overviewAccounts.map((account) => {
            const selected = effectiveAccountId === account.id;
            const label = `${platformLabel(account.platform)} · ${accountHandle(account.username, platformLabel(account.platform), account.platform)}${account.status === "inactive" ? " · Inactive" : ""}`;
            return (
              <DitherPressable
                key={account.id}
                radius={shape.medium}
                focusColor={colors.focus}
                accessibilityRole="button"
                accessibilityLabel={selected ? `${label}, selected` : label}
                accessibilityState={{ selected }}
                accessibilityHint="Filter analytics by account"
                onPress={() => {
                  setAccountId(account.id);
                  setAccountPickerOpen(false);
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 48,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.outlineVariant,
                  borderRadius: shape.medium,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <AccountAvatar
                  name={account.username || platformLabel(account.platform)}
                  platform={account.platform}
                  avatarUrl={account.avatar_url}
                  size={32}
                />
                <PlatformIcon platform={account.platform} size={20} />
                <Text style={[typography.bodyLarge, { flex: 1, color: colors.onSurface }]}>
                  {label}
                </Text>
              </DitherPressable>
            );
          })}
        </BottomDrawer>
      ) : null}
    </Screen>
  );
}

function Metric({
  label,
  value,
  detail,
  delta,
}: {
  label: string;
  value: string;
  detail: string;
  delta?: number;
}) {
  const { colors, spacing, typography } = useNativeTheme().manifest;
  const { fontScale } = useWindowDimensions();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: fontScale >= 1.3 ? "100%" : "45%",
        minWidth: 140,
        gap: spacing.extraSmall,
        paddingVertical: spacing.small,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.outlineVariant,
      }}
    >
      <BodyText>{label}</BodyText>
      <Text style={[typography.headlineLarge, { color: colors.onSurface }]}>{value}</Text>
      <BodyText>{detail}</BodyText>
      {delta !== undefined ? (
        <BodyText style={{ color: delta >= 0 ? colors.onSuccess : colors.error }}>
          {delta > 0 ? "+" : ""}
          {number.format(delta)}
        </BodyText>
      ) : null}
    </View>
  );
}

function TrendChart({
  points,
  measured,
  metric,
}: {
  metric: "visibility" | "engagement" | "followers";
  points: NonNullable<AnalyticsOverview["trends"]["visibility"]>;
  measured: boolean;
}) {
  const { colors, typography, spacing, decoration } = useNativeTheme().manifest;
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(1, width - spacing.large * 4);
  const chartHeight = 144;
  const maximum = Math.max(0, ...points.map((point) => point.value));
  const minimum = Math.min(0, ...points.map((point) => point.value));
  const chart = trendBars(
    points.map((point) => point.value),
    chartWidth,
    chartHeight,
  );
  const strip = gradientSvg({
    length: chartHeight,
    kind: "button",
    ink: colors.onSurface,
  });
  // The native theme adapter projects the web chart1 through chart5 palette here.
  const chartColor = decoration.celebration[0];
  const bars = chart.bars
    .map(
      (bar) =>
        `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" fill="${chartColor}"/><rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" fill="url(#bars)" opacity="0.16"/>`,
    )
    .join("");
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="${chartWidth}" height="${chartHeight}"><defs><pattern id="bars" width="8" height="${chartHeight}" patternUnits="userSpaceOnUse">${strip}</pattern></defs>${bars}<line x1="0" y1="${chart.baseline}" x2="${chartWidth}" y2="${chart.baseline}" stroke="${colors.outlineVariant}"/></svg>`;
  return (
    <DitherPanel>
      <BodyText>
        {metric === "followers"
          ? "Daily follower change"
          : `${metric === "visibility" ? "Visibility" : "Engagement"} snapshot change per day`}
      </BodyText>
      {!measured || !points.length ? (
        <BodyText>No {metric} measurements in this period.</BodyText>
      ) : (
        <>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${metric} by day. ${points.map((point) => `${point.date}: ${point.value}`).join(". ")}`}
          >
            <BodyText>{number.format(maximum)}</BodyText>
            <SvgXml xml={xml} width="100%" height={chartHeight} />
            {minimum < 0 ? <BodyText>{number.format(minimum)}</BodyText> : null}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: spacing.small,
                paddingTop: spacing.small,
              }}
            >
              <Text style={[typography.labelMedium, { color: colors.onSurfaceVariant }]}>
                {points[0].date}
              </Text>
              <Text style={[typography.labelMedium, { color: colors.onSurfaceVariant }]}>
                {points.at(-1)?.date}
              </Text>
            </View>
          </View>
        </>
      )}
    </DitherPanel>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filter: { flex: 1, minWidth: 90 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
