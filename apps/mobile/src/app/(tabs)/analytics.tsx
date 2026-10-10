import { DitherPressable } from "@/components/dither-pressable";
import { NativeText as Text } from "@/components/native-text";
import {
  hasEngagementMeasurement,
  type AnalyticsOverview,
  type AnalyticsRangeDays,
} from "@openpost/query-catalog";
import { gradientSvg } from "@openpost/dither/paint";
import { router } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { SvgXml } from "react-native-svg";

import { BottomDrawer } from "@/components/bottom-drawer";
import { trendBars } from "@/lib/analytics-chart";
import { DitherPanel } from "@/components/dither-panel";
import { PlatformIcon } from "@/components/platform-icon";
import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";
import {
  BodyText,
  Button,
  ContentSection,
  ContentTitle,
  EmptyState,
  Screen,
} from "@/components/ui";
import { WorkspaceHeader } from "@/components/workspace-header";
import { accountHandle, platformLabel } from "@/lib/format";
import { useAccounts, useAnalytics, useWorkspaceId } from "@/lib/queries";
import { useNativeTheme } from "@/theme";

const RANGES: readonly AnalyticsRangeDays[] = [7, 30, 90];
const number = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export default function AnalyticsScreen() {
  const workspaceId = useWorkspaceId();
  return <AnalyticsDashboard key={workspaceId} />;
}

function AnalyticsDashboard() {
  const { colors, spacing, typography, shape } = useNativeTheme().manifest;
  const [days, setDays] = useState<AnalyticsRangeDays>(30);
  const [trend, setTrend] = useState<"views" | "engagement" | "followers">("views");
  const [accountId, setAccountId] = useState("");
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const accounts = useAccounts();
  const query = useAnalytics({ days, accountId });
  const overview = query.data?.pages[0];
  const selectedAccount = accounts.data?.find((account) => account.id === accountId);
  const error = query.error instanceof Error ? query.error.message : "Try again.";
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
        <View style={styles.actions}>
          {RANGES.map((range) => (
            <Button
              key={range}
              title={`${range} days`}
              intent={days === range ? "primary" : "ordinary"}
              accessibilityState={{ selected: days === range }}
              onPress={() => setDays(range)}
              style={styles.filter}
            />
          ))}
        </View>
        <Button
          title={
            selectedAccount
              ? `${platformLabel(selectedAccount.platform)} · ${accountHandle(selectedAccount.account_username, platformLabel(selectedAccount.platform), selectedAccount.platform, selectedAccount.alias)}`
              : "All accounts"
          }
          intent="quiet"
          onPress={() => setAccountPickerOpen(true)}
          accessibilityHint="Filter analytics by account"
        />
      </View>
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
            <View style={styles.metrics}>
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
                detail={`${overview.summary.engagement.measured} of ${overview.content_total} destinations`}
              />
              <Metric
                label="Views"
                value={
                  overview.summary.views.measured
                    ? number.format(overview.summary.views.value)
                    : "No data"
                }
                detail={`${overview.summary.views.measured} of ${overview.content_total} destinations`}
              />
              {(["impressions", "reach"] as const).map((metric) => (
                <Metric
                  key={metric}
                  label={metric[0].toUpperCase() + metric.slice(1)}
                  value={
                    overview.summary[metric].measured
                      ? number.format(overview.summary[metric].value)
                      : "No data"
                  }
                  detail={`${overview.summary[metric].measured} of ${overview.content_total} destinations`}
                />
              ))}
              <Metric
                label="Published"
                value={number.format(overview.summary.published)}
                detail={`${days} days`}
              />
            </View>
            <View style={{ gap: spacing.small }}>
              <ContentTitle>Trends</ContentTitle>
              <View style={styles.actions}>
                {(["views", "engagement", "followers"] as const).map((metric) => (
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
                measured={overview.summary[trend].measured > 0}
              />
            </View>
            <View style={{ gap: spacing.small }}>
              <ContentTitle>Post performance</ContentTitle>
              {(overview.content?.length ?? 0) === 0 ? (
                <EmptyState title="No published posts in this period" />
              ) : (
                query.data?.pages
                  .flatMap((page) => page.content ?? [])
                  .map((post) => {
                    const publicationId = post.publication_id || post.reference.publication_id;
                    return (
                      <DitherPressable
                        radius={shape.medium}
                        focusColor={colors.focus}
                        key={post.reference.rendition_id}
                        accessibilityRole="button"
                        disabled={!publicationId}
                        onPress={() =>
                          publicationId &&
                          router.push({
                            pathname: "/publications/[id]",
                            params: { id: publicationId },
                          })
                        }
                        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                      >
                        <ContentSection
                          style={{
                            borderBottomColor: colors.outlineVariant,
                            borderBottomWidth: StyleSheet.hairlineWidth,
                          }}
                        >
                          <ContentTitle numberOfLines={2}>
                            {post.title || post.excerpt || "Untitled post"}
                          </ContentTitle>
                          <View style={styles.accountRow}>
                            <PlatformIcon platform={post.platform} size={18} />
                            <BodyText>
                              {platformLabel(post.platform)} ·{" "}
                              {accountHandle(
                                post.username,
                                platformLabel(post.platform),
                                post.platform,
                              )}
                            </BodyText>
                          </View>
                          <BodyText>
                            {"views" in post.metrics
                              ? `${number.format(post.metrics.views ?? 0)} views`
                              : "Views unavailable"}{" "}
                            ·{" "}
                            {hasEngagementMeasurement(post)
                              ? `${number.format(post.engagement)} engagements`
                              : "Engagement unavailable"}
                          </BodyText>
                        </ContentSection>
                      </DitherPressable>
                    );
                  })
              )}
            </View>
            {query.hasNextPage ? (
              <Button
                title={query.isFetchingNextPage ? "Loading posts…" : "More posts"}
                disabled={query.isFetchingNextPage}
                onPress={() => void query.fetchNextPage()}
              />
            ) : null}
            <View style={{ gap: spacing.small }}>
              <ContentTitle>Audience by account</ContentTitle>
              {(overview.accounts?.length ?? 0) === 0 ? (
                <EmptyState title="No account measurements yet" />
              ) : (
                overview.accounts?.map((account) => (
                  <ContentSection
                    key={account.id}
                    style={{
                      borderBottomColor: colors.outlineVariant,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    }}
                  >
                    <View style={styles.accountRow}>
                      <PlatformIcon platform={account.platform} />
                      <View style={{ flex: 1 }}>
                        <ContentTitle>
                          {accountHandle(
                            account.username,
                            platformLabel(account.platform),
                            account.platform,
                          )}
                        </ContentTitle>
                        <BodyText>
                          {platformLabel(account.platform)}
                          {account.stale ? " · Out of date" : ""}
                        </BodyText>
                      </View>
                      <Text style={[typography.titleLarge, { color: colors.onSurface }]}>
                        {"followers" in account.metrics
                          ? number.format(account.metrics.followers)
                          : "No data"}
                      </Text>
                    </View>
                    {account.error_message ? (
                      <BodyText accessibilityRole="alert">{account.error_message}</BodyText>
                    ) : null}
                    {!account.account_supported ? (
                      <BodyText>Account analytics unavailable</BodyText>
                    ) : null}
                  </ContentSection>
                ))
              )}
            </View>
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
      {accountPickerOpen ? (
        <BottomDrawer open title="Accounts" onDismiss={() => setAccountPickerOpen(false)}>
          {accounts.isError ? (
            <QueryNotice message="Could not load accounts." retry={() => void accounts.refetch()} />
          ) : null}
          <Button
            title="All accounts"
            intent={accountId ? "ordinary" : "primary"}
            accessibilityState={{ selected: !accountId }}
            onPress={() => {
              setAccountId("");
              setAccountPickerOpen(false);
            }}
          />
          {accounts.data?.map((account) => (
            <Button
              key={account.id}
              title={`${platformLabel(account.platform)} · ${accountHandle(account.account_username, platformLabel(account.platform), account.platform, account.alias)}`}
              intent={accountId === account.id ? "primary" : "ordinary"}
              accessibilityState={{ selected: accountId === account.id }}
              onPress={() => {
                setAccountId(account.id);
                setAccountPickerOpen(false);
              }}
            />
          ))}
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
  metric: "views" | "engagement" | "followers";
  points: NonNullable<AnalyticsOverview["trends"]["views"]>;
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
          : `${metric === "views" ? "Views" : "Engagement"} per day`}
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
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  accountRow: { flexDirection: "row", alignItems: "center", gap: 12 },
});
