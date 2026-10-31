import { Pressable, ScrollView, View } from "react-native";
import { NativeText as Text } from "@/components/native-text";
import { useNativeTheme } from "@/theme";
import type { MobileAccount } from "@/lib/queries";
import { platformLabel } from "@/lib/format";

export function InboxStatusTabs<T extends string>({
  values,
  selected,
  onSelect,
}: {
  values: readonly { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  const { colors, spacing, typography } = useNativeTheme().manifest;
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        columnGap: spacing.large,
        rowGap: spacing.small,
      }}
    >
      {values.map(({ value, label }) => {
        const active = selected === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(value)}
            style={({ pressed }) => ({
              alignItems: "center",
              justifyContent: "center",
              minHeight: 44,
              opacity: pressed ? 0.75 : 1,
              paddingHorizontal: 2,
            })}
          >
            <Text
              style={[
                typography.labelLarge,
                { color: active ? colors.onSurface : colors.onSurfaceVariant },
              ]}
            >
              {label}
            </Text>
            <View
              style={{
                alignSelf: "stretch",
                backgroundColor: active ? colors.primary : "transparent",
                borderRadius: 1,
                height: 2,
                marginTop: 3,
              }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

function FilterChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const { colors, shape, spacing, typography } = useNativeTheme().manifest;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: active ? colors.primaryContainer : "transparent",
        borderColor: active ? "transparent" : colors.outlineVariant,
        borderRadius: shape.full,
        borderWidth: 1,
        justifyContent: "center",
        minHeight: 44,
        opacity: pressed ? 0.75 : 1,
        paddingHorizontal: spacing.medium,
      })}
    >
      <Text
        style={[
          typography.labelMedium,
          { color: active ? colors.onPrimaryContainer : colors.onSurfaceVariant },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function AccountFilter({
  accounts,
  value,
  onChange,
}: {
  accounts: readonly MobileAccount[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      <FilterChip label="All accounts" active={!value} onPress={() => onChange("")} />
      {accounts.map((account) => (
        <FilterChip
          key={account.id}
          label={`${account.alias || account.account_username} · ${platformLabel(account.platform)}`}
          active={value === account.id}
          onPress={() => onChange(account.id)}
        />
      ))}
    </ScrollView>
  );
}
export function InboxDivider() {
  const { colors } = useNativeTheme().manifest;
  return <View style={{ height: 1, backgroundColor: colors.outlineVariant }} />;
}
