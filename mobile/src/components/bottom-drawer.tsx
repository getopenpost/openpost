import type { PropsWithChildren } from "react";
import { ModalBottomSheet } from "@swmansion/react-native-bottom-sheet";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  KeyboardAwareScrollView,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemeIcon } from "@/components/theme-icon";
import { drawerBottomPadding } from "@/lib/bottom-drawer-layout";
import { useNativeTheme } from "@/theme";

export function BottomDrawer({
  children,
  onDismiss,
  open,
  title,
}: PropsWithChildren<{
  onDismiss: () => void;
  open: boolean;
  title: string;
}>) {
  const theme = useNativeTheme();
  const { colors, shape, spacing, typography } = theme.manifest;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const restingBottomPadding = Math.max(spacing.extraLarge, insets.bottom + spacing.medium);
  const { height: keyboardTranslation } = useReanimatedKeyboardAnimation();
  const keyboardPaddingStyle = useAnimatedStyle(() => ({
    paddingBottom: drawerBottomPadding(restingBottomPadding, keyboardTranslation.value),
  }));

  return (
    <ModalBottomSheet
      animateContentHeight={false}
      detents={[0, "content"]}
      index={open ? 1 : 0}
      onIndexChange={(index) => {
        if (index === 0) onDismiss();
      }}
      scrimColor={colors.scrim}
      surface={
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: shape.extraLarge,
              borderTopRightRadius: shape.extraLarge,
            },
          ]}
        />
      }
    >
      <Animated.View style={[styles.drawer, { maxHeight: height * 0.9 }, keyboardPaddingStyle]}>
        <View
          style={[
            styles.handle,
            {
              backgroundColor: colors.outlineVariant,
              marginTop: spacing.medium,
            },
          ]}
        />
        <View
          style={[styles.heading, { paddingHorizontal: spacing.large, paddingTop: spacing.medium }]}
        >
          <Text style={[styles.title, typography.titleLarge, { color: colors.onSurface }]}>
            {title}
          </Text>
          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.closeButton,
              { backgroundColor: colors.background },
              pressed && styles.pressed,
            ]}
          >
            <ThemeIcon role="close" size={24} tintColor={colors.onSurface} />
          </Pressable>
        </View>
        <KeyboardAwareScrollView
          bottomOffset={18}
          contentContainerStyle={{ gap: spacing.large, padding: spacing.large }}
          contentInsetAdjustmentBehavior="never"
          keyboardDismissMode={process.env.EXPO_OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
        >
          {children}
        </KeyboardAwareScrollView>
      </Animated.View>
    </ModalBottomSheet>
  );
}

const styles = StyleSheet.create({
  closeButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  drawer: {
    flexShrink: 1,
    overflow: "hidden",
  },
  handle: {
    alignSelf: "center",
    borderRadius: 999,
    height: 5,
    width: 42,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  pressed: {
    opacity: 0.72,
  },
  scroll: {
    flexShrink: 1,
  },
  title: {
    flex: 1,
  },
});
