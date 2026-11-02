import { NativeText } from "@/components/native-text";
import { AccountAvatar } from "@/components/account-avatar";
import { DitherPressable } from "@/components/dither-pressable";
import { MediaImage } from "@/components/media-image";
import { PlatformIcon } from "@/components/platform-icon";
import { StyleSheet, View } from "react-native";

import { BodyText, StatusBadge } from "@/components/ui";
import { ThemeIcon } from "@/components/theme-icon";
import { useAccounts, type PublicationListItem } from "@/lib/queries";
import { accountHandle, platformLabel } from "@/lib/format";
import { useNativeTheme } from "@/theme";

function publicationTitle(publication: PublicationListItem) {
  return (
    publication.source_text?.trim() ||
    publication.title?.trim() ||
    publication.renditions?.find((rendition) => rendition.body?.trim())?.body ||
    "Untitled post"
  );
}

export function PublicationRow({
  publication,
  onPress,
  detail,
  showStatus = false,
}: {
  publication: PublicationListItem;
  onPress: () => void;
  detail: string;
  showStatus?: boolean;
}) {
  const { colors, shape, spacing, typography } = useNativeTheme().manifest;
  const accounts = useAccounts();
  const title = publicationTitle(publication);
  const platforms = [
    ...new Set(publication.renditions?.map((rendition) => rendition.platform).filter(Boolean)),
  ];
  const seenPlatforms = new Set<string>();
  const destinations = (publication.renditions ?? []).filter((rendition) => {
    if (!rendition.platform || seenPlatforms.has(rendition.platform)) return false;
    seenPlatforms.add(rendition.platform);
    return true;
  });
  const image = publication.media?.find((media) => media.mime_type?.startsWith("image/"));
  return (
    <DitherPressable
      radius={shape.medium}
      focusColor={colors.focus}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}. ${platforms.map(platformLabel).join(", ")}${showStatus ? `. ${publication.status}` : ""}`}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.medium,
          paddingVertical: spacing.medium,
          minHeight: 80,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.outlineVariant,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      {image?.url ? (
        <MediaImage
          uri={image.url}
          size="md"
          contentFit="cover"
          style={{ width: 64, height: 56, borderRadius: shape.medium }}
        />
      ) : null}
      <View style={{ flex: 1, gap: spacing.extraSmall }}>
        <NativeText numberOfLines={2} style={[typography.bodyLarge, { color: colors.onSurface }]}>
          {title}
        </NativeText>
        <BodyText numberOfLines={2}>{detail}</BodyText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {destinations.map((rendition) => {
            const account = accounts.data?.find(
              (candidate) => candidate.id === rendition.social_account_id,
            );
            if (!account && accounts.data === undefined) {
              return <PlatformIcon key={rendition.id} platform={rendition.platform!} size={18} />;
            }
            return (
              <View
                key={rendition.id}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" }}
              >
                <AccountAvatar
                  name={
                    account
                      ? accountHandle(
                          account.account_username,
                          platformLabel(rendition.platform!),
                          rendition.platform!,
                          account.alias,
                        )
                      : platformLabel(rendition.platform!)
                  }
                  platform={rendition.platform!}
                  avatarUrl={account?.account_avatar_url}
                  size={28}
                />
                {platformLabel(rendition.platform!) === "YouTube" ? (
                  <NativeText
                    style={[
                      typography.labelMedium,
                      { color: colors.onSurfaceVariant, flexShrink: 1 },
                    ]}
                  >
                    YouTube
                  </NativeText>
                ) : null}
              </View>
            );
          })}
        </View>
        {showStatus ? <StatusBadge status={publication.status} /> : null}
      </View>
      <ThemeIcon role="disclosure" size={16} tintColor={colors.onSurfaceVariant} />
    </DitherPressable>
  );
}
