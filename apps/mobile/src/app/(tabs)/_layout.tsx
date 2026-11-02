import { useQuery } from "@tanstack/react-query";
import { inboxSummaryQueryOptions } from "@openpost/query-catalog";
import { mobileInboxAPI } from "@/lib/inbox/api";
import { useWorkspaceCapabilities, useWorkspaceId } from "@/lib/queries";
import { InboxSessionBoundary } from "@/components/inbox/session-boundary";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useColors } from "@/components/ui";
import { navigationPresentation, useNativeTheme } from "@/theme";
import { resolveNativeThemeNavigationIcon } from "@/theme/native-tab-icons";

export default function TabLayout() {
  return (
    <InboxSessionBoundary>
      <NativeTabLayout />
    </InboxSessionBoundary>
  );
}
function NativeTabLayout() {
  const colors = useColors();
  const workspaceId = useWorkspaceId() ?? "";
  const canEdit = Boolean(useWorkspaceCapabilities()?.can_edit);
  const summary = useQuery({
    ...inboxSummaryQueryOptions(mobileInboxAPI, workspaceId),
    refetchInterval: 60_000,
  });
  const unread = (summary.data?.unread_conversations ?? 0) + (summary.data?.unread_comments ?? 0);
  const theme = useNativeTheme();
  const drafts = resolveNativeThemeNavigationIcon(theme.manifest, "drafts");
  const inbox = resolveNativeThemeNavigationIcon(theme.manifest, "inbox");
  const more = resolveNativeThemeNavigationIcon(theme.manifest, "more");
  const navigation = navigationPresentation(theme.manifest);
  const label = theme.manifest.typography.labelMedium;

  // Expo's native UIKit and Material tab hosts own their physical height and safe-area inset.
  // NativeTabs exposes no height prop, so the validated requestedHeight remains available to
  // custom navigation renderers instead of being faked with content padding here.
  return (
    <NativeTabs
      backgroundColor={navigation.backgroundColor}
      blurEffect="none"
      disableIndicator={navigation.disableIndicator}
      disableTransparentOnScrollEdge
      iconColor={{
        default: navigation.defaultColor,
        selected: navigation.selectedColor,
      }}
      indicatorColor={navigation.indicatorColor}
      labelStyle={{
        default: {
          color: navigation.defaultColor,
          fontFamily: label.fontFamily,
          fontSize: label.fontSize,
          fontWeight: label.fontWeight,
        },
        selected: {
          color: navigation.selectedColor,
          fontFamily: label.fontFamily,
          fontSize: label.fontSize,
          fontWeight: label.fontWeight,
        },
      }}
      labelVisibilityMode="labeled"
      minimizeBehavior="never"
      rippleColor={colors.primaryContainer}
      shadowColor={navigation.shadowColor}
      tintColor={navigation.selectedColor}
    >
      {/* The phone navigation mirrors the web Calm contract: Home, Posts, New,
          Inbox, More, all labelled. Analytics and Media live under More. */}
      <NativeTabs.Trigger name="home">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house" md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="posts">
        <NativeTabs.Trigger.Label>Posts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon renderingMode="template" src={drafts} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="new" hidden={!canEdit}>
        <NativeTabs.Trigger.Label>New</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="plus" md="add" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
        {unread > 0 ? (
          <NativeTabs.Trigger.Badge>
            {unread > 99 ? "99+" : String(unread)}
          </NativeTabs.Trigger.Badge>
        ) : null}
        <NativeTabs.Trigger.Icon renderingMode="template" src={inbox} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon renderingMode="template" src={more} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
