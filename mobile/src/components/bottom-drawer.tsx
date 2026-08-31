import type { PropsWithChildren } from "react";
import { ModalBottomSheet } from "@swmansion/react-native-bottom-sheet";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  KeyboardAwareScrollView,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/components/ui";
import { drawerBottomPadding } from "@/lib/bottom-drawer-layout";

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
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const restingBottomPadding = Math.max(24, insets.bottom + 12);
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
      scrimColor="rgba(0, 0, 0, 0.62)"
      surface={
        <View style={[StyleSheet.absoluteFill, styles.surface, { backgroundColor: colors.card }]} />
      }
    >
      <Animated.View style={[styles.drawer, { maxHeight: height * 0.9 }, keyboardPaddingStyle]}>
        <View style={[styles.handle, { backgroundColor: colors.separator }]} />
        <View style={styles.heading}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.closeButton,
              { backgroundColor: colors.bg },
              pressed && styles.pressed,
            ]}
          >
            <SymbolView
              name={{ ios: "xmark", android: "close" }}
              size={24}
              tintColor={colors.text}
            />
          </Pressable>
        </View>
        <KeyboardAwareScrollView
          bottomOffset={18}
          contentContainerStyle={styles.content}
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
  content: {
    gap: 18,
    padding: 18,
  },
  drawer: {
    flexShrink: 1,
    overflow: "hidden",
  },
  handle: {
    alignSelf: "center",
    borderRadius: 999,
    height: 5,
    marginTop: 10,
    width: 42,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  pressed: {
    opacity: 0.72,
  },
  scroll: {
    flexShrink: 1,
  },
  surface: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  title: {
    flex: 1,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
});
