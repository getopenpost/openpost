import { useState } from "react";
import type { AnalyticsOverview } from "@openpost/query-catalog";
import { hasEngagementMeasurement } from "@openpost/query-catalog";
import { View, StyleSheet, useWindowDimensions } from "react-native";
import { AccountAvatar } from "./account-avatar";
import { BodyText, Button, ContentSection, ContentTitle } from "./ui";
import { useNativeTheme } from "@/theme";
import { accountHandle, platformLabel } from "@/lib/format";

export type AnalyticsPost = NonNullable<AnalyticsOverview["content"]>[number];
type Reference = AnalyticsPost["reference"];
const number = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
export const visibilityBasisLabel = (basis: string) =>
  basis === "post_displays"
    ? "post impressions"
    : basis === "video_views"
      ? "video views"
      : "content views";

export function AnalyticsTakeaways({
  overview,
  onOpen,
  onRestore,
  onRepurpose,
  canRepurpose,
}: {
  canRepurpose: boolean;
  overview: AnalyticsOverview;
  onOpen: (reference: Reference) => void;
  onRestore: (accountId: string) => void;
  onRepurpose: (reference: Reference) => void;
}) {
  const { spacing } = useNativeTheme().manifest;
  const compact = useWindowDimensions().width < 640;
  const [expanded, setExpanded] = useState(false);
  const recommendations = overview.takeaways ?? [];
  const visible = compact && !expanded ? recommendations.slice(0, 1) : recommendations;
  return (
    <View style={{ gap: spacing.small }}>
      <ContentTitle>What to do next</ContentTitle>
      {!overview.takeaways?.length ? (
        <BodyText>
          No recommendations yet. More comparable measurements are needed to suggest a next step.
        </BodyText>
      ) : (
        visible.map((item) => (
          <ContentSection key={`${item.kind}:${item.account_id}`}>
            <ContentTitle>
              {item.kind === "restore_measurements"
                ? "Restore measurements"
                : "Build on a strong post"}
            </ContentTitle>
            <BodyText>
              {platformLabel(item.platform)} ·{" "}
              {accountHandle(item.username, platformLabel(item.platform), item.platform)}
            </BodyText>
            {item.kind === "repurpose_post" ? (
              <>
                {item.title || item.excerpt ? (
                  <BodyText numberOfLines={3}>Source: {item.title || item.excerpt}</BodyText>
                ) : null}
                <BodyText>
                  {number.format(item.value)} engagements · account baseline{" "}
                  {item.baseline === undefined ? "unavailable" : number.format(item.baseline)}{" "}
                  across {item.comparison_sample} comparable outputs.
                </BodyText>
                <BodyText>
                  Review the source and adapt what worked. Results do not guarantee a repeat
                  outcome.
                </BodyText>
                {item.reference ? (
                  <View style={{ gap: spacing.small }}>
                    {canRepurpose ? (
                      <Button
                        title="Repurpose in web app"
                        intent="ordinary"
                        onPress={() => {
                          if (item.reference) onRepurpose(item.reference);
                        }}
                      />
                    ) : null}
                    <Button
                      title="Open post"
                      intent="quiet"
                      onPress={() => {
                        if (item.reference) onOpen(item.reference);
                      }}
                    />
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <BodyText>
                  Collection needs attention. Check this account’s connection and permissions.
                </BodyText>
                <Button
                  title="Manage account"
                  intent="ordinary"
                  onPress={() => onRestore(item.account_id)}
                />
              </>
            )}
          </ContentSection>
        ))
      )}
      {compact && recommendations.length > 1 ? (
        <Button
          title={
            expanded
              ? "Show fewer recommendations"
              : `Show ${recommendations.length - 1} more recommendations`
          }
          intent="quiet"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
        />
      ) : null}
    </View>
  );
}

export function AnalyticsAccountPerformance({
  overview,
  onSelect,
}: {
  overview: AnalyticsOverview;
  onSelect: (accountId: string) => void;
}) {
  const { colors, spacing } = useNativeTheme().manifest;
  return (
    <View style={{ gap: spacing.small }}>
      <ContentTitle>Account performance</ContentTitle>
      {!overview.performance?.length ? (
        <BodyText>No account results in this period.</BodyText>
      ) : (
        overview.performance.map((account) => (
          <ContentSection
            key={account.account_id}
            style={{
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: colors.outlineVariant,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                gap: spacing.small,
                alignItems: "center",
              }}
            >
              <AccountAvatar
                name={account.username}
                platform={account.platform}
                avatarUrl={account.avatar_url}
              />
              <View style={{ flex: 1 }}>
                <ContentTitle>
                  {accountHandle(
                    account.username,
                    platformLabel(account.platform),
                    account.platform,
                  )}
                </ContentTitle>
                <BodyText>
                  {platformLabel(account.platform)} · {account.publication_count} posts ·{" "}
                  {account.published} outputs
                </BodyText>
                {account.status === "inactive" ? <BodyText>Inactive</BodyText> : null}
              </View>
            </View>
            <BodyText>
              Visibility{" "}
              {account.visibility.measured
                ? number.format(account.visibility.value)
                : "unavailable"}{" "}
              · Engagement{" "}
              {account.engagement.measured
                ? number.format(account.engagement.value)
                : "unavailable"}
            </BodyText>
            <BodyText>
              {account.followers === undefined
                ? "Followers unavailable"
                : `${number.format(account.followers)} followers`}
              {account.follower_delta === undefined
                ? ""
                : ` · ${account.follower_delta > 0 ? "+" : ""}${number.format(account.follower_delta)} change`}
            </BodyText>
            {account.status !== "ok" ? (
              <BodyText>Status: {account.status.replaceAll("_", " ")}</BodyText>
            ) : null}
            <Button
              title="Show this account"
              intent="quiet"
              onPress={() => onSelect(account.account_id)}
            />
          </ContentSection>
        ))
      )}
    </View>
  );
}

export function AnalyticsPostResult({
  post,
  rank,
  onInspect,
}: {
  post: AnalyticsPost;
  rank?: number;
  onInspect: (post: AnalyticsPost) => void;
}) {
  const { colors } = useNativeTheme().manifest;
  return (
    <ContentSection
      style={{
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.outlineVariant,
      }}
    >
      <ContentTitle numberOfLines={2}>
        {rank ? `${rank}. ` : ""}
        {post.title || post.excerpt || "Untitled post"}
      </ContentTitle>
      <BodyText>
        {platformLabel(post.platform)} ·{" "}
        {accountHandle(post.username, platformLabel(post.platform), post.platform)}
      </BodyText>
      <BodyText>
        {post.visibility
          ? `${number.format(post.visibility.value)} visibility`
          : "Visibility unavailable"}{" "}
        ·{" "}
        {hasEngagementMeasurement(post)
          ? `${number.format(post.engagement)} engagements`
          : "Engagement unavailable"}
      </BodyText>
      {post.visibility ? (
        <BodyText>Based on {visibilityBasisLabel(post.visibility.basis)}.</BodyText>
      ) : null}
      <Button title="View results and actions" intent="quiet" onPress={() => onInspect(post)} />
    </ContentSection>
  );
}

export function AnalyticsCoverage({ overview }: { overview: AnalyticsOverview }) {
  const { spacing } = useNativeTheme().manifest;
  return (
    <View style={{ gap: spacing.medium }}>
      <BodyText>
        Visibility counts platform-reported content displays or video plays, including repeats. It
        is not unique people or completed reads.
      </BodyText>
      <BodyText>
        Each output uses post impressions when available, otherwise views. YouTube uses video views,
        never thumbnail or ad impressions.
      </BodyText>
      <BodyText>
        {overview.summary.visibility?.measured ?? 0} of {overview.content_total} outputs have
        visibility measurements.
      </BodyText>
      {(overview.visibility_breakdown ?? []).map((item) => (
        <BodyText key={`${item.platform}:${item.metric}:${item.basis}`}>
          {platformLabel(item.platform)}: {number.format(item.value)}{" "}
          {visibilityBasisLabel(item.basis)} from {item.measured} outputs.
        </BodyText>
      ))}
      {(overview.performance ?? [])
        .filter((account) => account.visibility.measured < account.published)
        .map((account) => (
          <BodyText key={account.account_id}>
            {platformLabel(account.platform)} · {account.username}:{" "}
            {account.published - account.visibility.measured} outputs without visibility
            measurements.
          </BodyText>
        ))}
      <BodyText>
        Dates select posts published in the period. Outcomes are their saved lifetime totals.
        Follower changes and daily snapshot changes are separate measurements.
      </BodyText>
    </View>
  );
}
