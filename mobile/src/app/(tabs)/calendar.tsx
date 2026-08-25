import { router, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  BodyText,
  Button,
  Card,
  IconButton,
  Screen,
  StatusBadge,
  useColors,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { calendarOccurrence, dayKey, statusColor } from "@/lib/format";
import { useWorkspaceId } from "@/lib/queries";

const WEEKDAYS = [
  ["S", "Sunday"],
  ["M", "Monday"],
  ["T", "Tuesday"],
  ["W", "Wednesday"],
  ["T", "Thursday"],
  ["F", "Friday"],
  ["S", "Saturday"],
] as const;

export default function CalendarScreen() {
  const colors = useColors();
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<string>(() => dayKey(today));
  const workspaceId = useWorkspaceId();

  const monthStart = month;
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1);

  const publications = useQuery({
    queryKey: ["calendar", workspaceId, dayKey(monthStart), dayKey(monthEnd)],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      if (!workspaceId) throw new Error("Choose a workspace to load the calendar");
      const { data, error, response } = await api().GET("/publications", {
        params: {
          query: {
            workspace_id: workspaceId,
            calendar_from: monthStart.toISOString(),
            calendar_before: monthEnd.toISOString(),
            limit: 200,
          },
        },
      });
      if (error || !data) throw new Error(await errorMessage(response, "Could not load calendar"));
      return data ?? [];
    },
  });

  const byDay = useMemo(() => {
    const map = new Map<string, { id: string; title: string; status: string }[]>();
    for (const publication of publications.data ?? []) {
      const date = calendarOccurrence(publication);
      if (!date) continue;
      if (publication.status === "draft" || publication.status === "ready") continue;
      const key = dayKey(date);
      const list = map.get(key) ?? [];
      list.push({
        id: publication.id,
        title: publication.title ?? excerpt(publication) ?? "Untitled",
        status: publication.status,
      });
      map.set(key, list);
    }
    return map;
  }, [publications.data]);

  const cells = useMemo(() => {
    const firstWeekday = month.getDay();
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const result: (Date | null)[] = [];
    for (let i = 0; i < firstWeekday; i += 1) result.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      result.push(new Date(month.getFullYear(), month.getMonth(), day));
    }
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [month]);

  const selectedItems = byDay.get(selectedDay) ?? [];

  function shiftMonth(delta: number) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
    setSelectedDay("");
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>
          {month.toLocaleDateString("en", { month: "long" })}
          <Text style={{ color: colors.textSecondary }}> {month.getFullYear()}</Text>
        </Text>
        <View style={styles.nav}>
          <IconButton
            label="Previous month"
            name={{ ios: "chevron.left", android: "chevron_left" }}
            color={colors.tint}
            onPress={() => shiftMonth(-1)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to current month"
            onPress={() => {
              setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
              setSelectedDay(dayKey(today));
            }}
            style={({ pressed }) => [styles.todayButton, pressed && { opacity: 0.65 }]}
          >
            <Text style={{ color: colors.tint, fontSize: 15, fontWeight: "600" }}>Today</Text>
          </Pressable>
          <IconButton
            label="Next month"
            name={{ ios: "chevron.right", android: "chevron_right" }}
            color={colors.tint}
            onPress={() => shiftMonth(1)}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={publications.isRefetching}
            onRefresh={() => void publications.refetch()}
            tintColor={colors.textSecondary}
          />
        }
      >
        {publications.isLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.tint} />
        ) : null}
        {publications.isError ? (
          <Card style={styles.error}>
            <Text style={[styles.errorTitle, { color: colors.text }]}>Could not load calendar</Text>
            <BodyText accessibilityRole="alert">
              {publications.error instanceof Error
                ? publications.error.message
                : "Check your connection and try again."}
            </BodyText>
            <Button
              title="Try again"
              variant="tinted"
              onPress={() => void publications.refetch()}
            />
          </Card>
        ) : null}

        <View style={styles.weekdays}>
          {WEEKDAYS.map(([shortLabel, label], index) => (
            <Text
              accessibilityLabel={label}
              key={`${shortLabel}-${index}`}
              style={[styles.weekday, { color: colors.textSecondary }]}
            >
              {shortLabel}
            </Text>
          ))}
        </View>

        <View style={styles.grid}>
          {cells.map((date, index) => {
            if (!date) return <View key={`blank-${index}`} style={styles.cell} />;
            const key = dayKey(date);
            const items = byDay.get(key) ?? [];
            const isToday = key === dayKey(today);
            const isSelected = key === selectedDay;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={`${date.toLocaleDateString("en", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}. ${items.length === 0 ? "Nothing planned" : `${items.length} planned`}`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => setSelectedDay(key)}
                style={({ pressed }) => [styles.cell, pressed && { opacity: 0.6 }]}
              >
                <View
                  style={[
                    styles.dayCircle,
                    isSelected && { backgroundColor: colors.tint },
                    !isSelected && isToday && { borderWidth: 1.5, borderColor: colors.tint },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayNumber,
                      { color: colors.text },
                      isSelected && { color: colors.onTint, fontWeight: "700" },
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                </View>
                <View style={styles.dots}>
                  {items.slice(0, 3).map((item) => (
                    <View
                      key={item.id}
                      style={[
                        styles.dot,
                        {
                          backgroundColor: statusColor(item.status, colors.dark),
                        },
                      ]}
                    />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Card style={styles.daySheet}>
          <Text style={[styles.daySheetTitle, { color: colors.text }]}>
            {selectedDay
              ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })
              : "Select a day"}
          </Text>
          {selectedItems.length === 0 && !publications.isError ? (
            <BodyText>Nothing planned.</BodyText>
          ) : (
            selectedItems.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: "/post/[id]",
                    params: { id: item.id },
                  })
                }
                style={({ pressed }) => [styles.itemRow, pressed && { opacity: 0.5 }]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 15,
                      fontWeight: "500",
                    }}
                    numberOfLines={2}
                  >
                    {item.title}
                  </Text>
                  <StatusBadge status={item.status} />
                </View>
              </Pressable>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function excerpt(publication: { renditions?: { body?: string }[] | null }): string | null {
  for (const rendition of publication.renditions ?? []) {
    if (rendition.body) return rendition.body.split("\n")[0].slice(0, 80);
  }
  return null;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    flex: 1,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  todayButton: {
    minHeight: 48,
    minWidth: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    width: "100%",
    alignSelf: "stretch",
    padding: 16,
    paddingBottom: 40,
  },
  weekdays: {
    width: "100%",
    flexDirection: "row",
    marginBottom: 4,
  },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
  },
  grid: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / 7}%`,
    alignItems: "center",
    paddingVertical: 3,
    minHeight: 52,
  },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  dayNumber: {
    fontSize: 15,
  },
  dots: {
    flexDirection: "row",
    gap: 2,
    marginTop: 2,
    height: 4,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  daySheet: {
    marginTop: 16,
    gap: 12,
  },
  error: {
    gap: 12,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  daySheetTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: 10,
  },
});
