// Shared native account and workspace identity.
//
// Every account surface renders this instead of a standalone PlatformIcon: the
// provider avatar when one exists, a DOM-free monogram fallback otherwise, and
// the platform mark from the generated catalogue in both cases, except YouTube,
// whose compact attribution uses the provider's text label. Workspace
// identity uses the same avatar/monogram treatment with an optional colour
// ring and no platform mark. Both are decorative to screen readers because the
// adjacent text already names the account or workspace.

import { Image } from "expo-image";
import { useState, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";

import { NativeText } from "@/components/native-text";
import { PlatformIcon } from "@/components/platform-icon";
import { getToken, subscribeToken } from "@/lib/api/token-store";
import { accountInitials, avatarImageSource } from "@/lib/avatar-source";
import { getServer, subscribeServer } from "@/lib/server";
import { useNativeTheme } from "@/theme";

export interface AccountAvatarProps {
  name: string;
  platform: string;
  avatarUrl?: string | null;
  size?: number;
  testID?: string;
}

export function AccountAvatar({
  name,
  platform,
  avatarUrl,
  size = 36,
  testID,
}: AccountAvatarProps) {
  const { colors, typography } = useNativeTheme().manifest;
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);
  const [failed, setFailed] = useState(false);
  const source = avatarUrl ? avatarImageSource(avatarUrl, server?.baseUrl ?? "", token) : null;
  const showImage = Boolean(source) && !failed;
  const badgeSize = Math.max(14, Math.round(size * 0.45));
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <Image
          source={source!}
          // Public avatars are cacheable; only credentialed previews opt out.
          cachePolicy={source!.headers ? "none" : "memory-disk"}
          recyclingKey={source!.uri}
          contentFit="cover"
          onError={() => setFailed(true)}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
        />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.secondaryContainer,
          }}
        >
          <NativeText
            style={[
              typography.labelLarge,
              { color: colors.onSecondaryContainer, fontSize: Math.round(size * 0.36) },
            ]}
          >
            {accountInitials(name)}
          </NativeText>
        </View>
      )}
      {platform.split(":")[0].toLowerCase() !== "youtube" && (
        <View
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.outlineVariant,
          }}
        >
          <PlatformIcon platform={platform} size={badgeSize - 6} />
        </View>
      )}
    </View>
  );
}

export interface WorkspaceAvatarProps {
  name: string;
  avatarUrl?: string | null;
  color?: string | null;
  size?: number;
  testID?: string;
}

export function WorkspaceAvatar({
  name,
  avatarUrl,
  color,
  size = 32,
  testID,
}: WorkspaceAvatarProps) {
  const { colors, typography } = useNativeTheme().manifest;
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);
  const [failed, setFailed] = useState(false);
  const source = avatarUrl ? avatarImageSource(avatarUrl, server?.baseUrl ?? "", token) : null;
  const showImage = Boolean(source) && !failed;
  const ring = color ? { borderWidth: 2, borderColor: color } : null;
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <Image
          source={source!}
          cachePolicy={source!.headers ? "none" : "memory-disk"}
          recyclingKey={source!.uri}
          contentFit="cover"
          onError={() => setFailed(true)}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }, ring]}
        />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.secondaryContainer,
          }}
        >
          <NativeText
            style={[
              typography.labelLarge,
              { color: colors.onSecondaryContainer, fontSize: Math.round(size * 0.36) },
            ]}
          >
            {accountInitials(name)}
          </NativeText>
        </View>
      )}
    </View>
  );
}
