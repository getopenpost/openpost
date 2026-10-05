import { DitherPressable } from "@/components/dither-pressable";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { BodyText, ContentTitle, StatusBadge } from "@/components/ui";
import { ThemeIcon } from "@/components/theme-icon";
import type { PublicationListItem } from "@/lib/queries";
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
  const { colors, shape, spacing } = useNativeTheme().manifest;
  const title = publicationTitle(publication);
  const image = publication.media?.find((media) => media.mime_type?.startsWith("image/"));
  return (
    <DitherPressable
      radius={shape.medium}
      focusColor={colors.focus}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}${showStatus ? `. ${publication.status}` : ""}`}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.medium,
          paddingVertical: spacing.large,
          minHeight: 88,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.outlineVariant,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      {image?.url ? (
        <Image
          source={{ uri: image.url }}
          contentFit="cover"
          style={{ width: 64, height: 64, borderRadius: shape.medium }}
        />
      ) : (
        <View
          style={{
            width: 48,
            height: 56,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <ThemeIcon role="drafts" size={26} tintColor={colors.onSurfaceVariant} />
        </View>
      )}
      <View style={{ flex: 1, gap: spacing.extraSmall }}>
        <ContentTitle numberOfLines={2}>{title}</ContentTitle>
        <BodyText numberOfLines={2}>{detail}</BodyText>
        {showStatus ? <StatusBadge status={publication.status} /> : null}
      </View>
      <ThemeIcon role="disclosure" size={16} tintColor={colors.onSurfaceVariant} />
    </DitherPressable>
  );
}
