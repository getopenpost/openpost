import { Stack } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import { ScrollView, View } from "react-native";
import { BodyText, Screen, SectionHeader } from "@/components/ui";
import { NativeText } from "@/components/native-text";
import { DitherPressable } from "@/components/dither-pressable";
import { nativeTelemetry } from "@/lib/telemetry";
import { getServer, subscribeServer } from "@/lib/server";
import { useNativeTheme } from "@/theme";

export default function PrivacyScreen() {
  const server = useSyncExternalStore(subscribeServer, getServer);
  const { colors, spacing, shape, typography } = useNativeTheme().manifest;
  const choice = useSyncExternalStore(nativeTelemetry.subscribe, nativeTelemetry.getChoice);
  const available = useSyncExternalStore(nativeTelemetry.subscribe, nativeTelemetry.isAvailable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function choose(next: "allow" | "off") {
    setBusy(true);
    setError(null);
    try {
      await nativeTelemetry.choose(next, server?.baseUrl ?? null);
    } catch {
      setError("Could not update analytics. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen safeTop={false}>
      <Stack.Screen
        options={{
          title: "Privacy",
          headerShown: true,
          headerBackTitle: "Back",
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.large, gap: spacing.large }}
      >
        <View style={{ gap: spacing.medium }}>
          <SectionHeader label="App analytics" />
          <BodyText>
            Share screen visits, selected actions and technical errors with the analytics service
            for this server. Post text, media and session recordings stay out of analytics.
          </BodyText>
          <BodyText>
            This choice applies to this server on this device. Analytics stays off until you allow
            it.
          </BodyText>
          {!available ? (
            <BodyText>This server is not currently providing app analytics.</BodyText>
          ) : null}
          {(
            [
              ["off", "Decline"],
              ["allow", "Allow analytics"],
            ] as const
          ).map(([value, label]) => (
            <DitherPressable
              key={value}
              radius={shape.medium}
              focusColor={colors.focus}
              accessibilityRole="radio"
              accessibilityLabel={choice === value ? `${label}, Selected` : label}
              accessibilityState={{
                checked: choice === value,
                disabled: busy || (value === "allow" && !available),
              }}
              disabled={busy || (value === "allow" && !available)}
              onPress={() => void choose(value)}
              style={{
                minHeight: 48,
                justifyContent: "center",
                paddingHorizontal: spacing.medium,
                borderWidth: 1,
                borderColor: choice === value ? colors.primary : colors.outline,
              }}
            >
              <NativeText style={[typography.bodyLarge, { color: colors.onSurface }]}>
                {choice === value ? `${label}, Selected` : label}
              </NativeText>
            </DitherPressable>
          ))}
          {error ? (
            <BodyText accessibilityRole="alert" style={{ color: colors.error }}>
              {error}
            </BodyText>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
