import { router, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { BodyText, Card, IconButton, Screen, StatusBadge, useColors } from "@/components/ui";
import { calendarWeeks } from "@/lib/calendar";
import { calendarOccurrence, dayKey, statusColor } from "@/lib/format";
import { useCalendarPublications } from "@/lib/queries";
import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";

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

  const monthStart = month;
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const publications = useCalendarPublications(monthStart.toISOString(), monthEnd.toISOString());

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

  const weeks = useMemo(() => calendarWeeks(month), [month]);

  const selectedItems = byDay.get(selectedDay) ?? [];
  const hasData = publications.data !== undefined;
  const coldPending = !hasData && publications.isPending;

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
        <DelayedQueryPlaceholder
          pending={coldPending}
          shape="calendar"
          offline={publications.fetchStatus === "paused"}
        />
        {publications.isError && !hasData ? (
          <InitialQueryError
            title="Could not load calendar"
            message={
              publications.error instanceof Error
                ? publications.error.message
                : "Check your connection and try again."
            }
            retry={() => void publications.refetch()}
          />
        ) : null}
        {publications.isError && hasData ? (
          <QueryNotice
            message="Could not refresh the calendar. Current dates remain visible."
            retry={() => void publications.refetch()}
          />
        ) : null}
        {hasData && publications.fetchStatus === "paused" ? (
          <QueryNotice message="You are offline. Current calendar dates remain visible." offline />
        ) : null}

        {hasData ? (
          <>
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
              {weeks.map((week, weekIndex) => (
                <View key={`week-${weekIndex}`} style={styles.weekRow}>
                  {week.map((date, dayIndex) => {
                    if (!date) {
                      return <View key={`blank-${weekIndex}-${dayIndex}`} style={styles.cell} />;
                    }
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
                            !isSelected &&
                              isToday && { borderWidth: 1.5, borderColor: colors.tint },
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
                                { backgroundColor: statusColor(item.status, colors.dark) },
                              ]}
                            />
                          ))}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
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
              {selectedItems.length === 0 && publications.data !== undefined ? (
                <BodyText>Nothing planned.</BodyText>
              ) : (
                selectedItems.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({
                        pathname: "/publications/[id]",
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
          </>
        ) : null}
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
  },
  weekRow: {
    flexDirection: "row",
    width: "100%",
  },
  cell: {
    flex: 1,
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
