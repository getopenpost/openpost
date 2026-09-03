import { router, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";
import {
  Card,
  ContentTitle,
  EmptyState,
  IconButton,
  PageTitle,
  Screen,
  StatusBadge,
} from "@/components/ui";
import { calendarWeeks } from "@/lib/calendar";
import { calendarOccurrence, dayKey, statusColor } from "@/lib/format";
import { useCalendarPublications } from "@/lib/queries";
import { useNativeTheme } from "@/theme";

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
  const theme = useNativeTheme();
  const { colors, shape, spacing, typography } = theme.manifest;
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
  const selectedDayTitle = selectedDay
    ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "Select a day";
  const hasData = publications.data !== undefined;
  const coldPending = !hasData && publications.isPending;

  function shiftMonth(delta: number) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
    setSelectedDay("");
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          styles.header,
          {
            paddingBottom: spacing.medium,
            paddingHorizontal: spacing.extraLarge,
            paddingTop: spacing.large,
          },
        ]}
      >
        <PageTitle style={styles.title}>
          {month.toLocaleDateString("en", { month: "long" })}
          <Text style={{ color: colors.onSurfaceVariant }}> {month.getFullYear()}</Text>
        </PageTitle>
        <View style={[styles.nav, { gap: spacing.extraSmall }]}>
          <IconButton
            label="Previous month"
            role="back"
            color={colors.primary}
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
            <Text style={[typography.labelLarge, { color: colors.primary }]}>Today</Text>
          </Pressable>
          <IconButton
            label="Next month"
            role="next"
            color={colors.primary}
            onPress={() => shiftMonth(1)}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            padding: spacing.large,
            paddingBottom: spacing.doubleExtraLarge + spacing.large,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={publications.isRefetching}
            onRefresh={() => void publications.refetch()}
            tintColor={colors.onSurfaceVariant}
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
                  style={[styles.weekday, typography.labelMedium, { color: colors.onSurfaceVariant }]}
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
                            { borderRadius: shape.full },
                            isSelected && { backgroundColor: colors.primary },
                            !isSelected &&
                              isToday && {
                                borderWidth: 1.5,
                                borderColor: colors.primary,
                              },
                          ]}
                        >
                          <Text
                            style={[
                              typography.bodyMedium,
                              { color: colors.onSurface },
                              isSelected && typography.labelLarge,
                              isSelected && { color: colors.onPrimary },
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
                                  backgroundColor: statusColor(
                                    item.status,
                                    colors.status,
                                    colors.onSurfaceVariant,
                                  ),
                                },
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

            {selectedItems.length === 0 ? (
              <EmptyState
                title={selectedDayTitle}
                body={selectedDay ? "Nothing planned." : "Choose a day to see its posts."}
              />
            ) : (
              <Card style={[styles.daySheet, { gap: spacing.medium }]}>
                <ContentTitle>{selectedDayTitle}</ContentTitle>
                {selectedItems.map((item) => (
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
                    <View style={{ flex: 1, gap: spacing.extraSmall }}>
                      <Text
                        style={[typography.bodyLarge, { color: colors.onSurface }]}
                        numberOfLines={2}
                      >
                        {item.title}
                      </Text>
                      <StatusBadge status={item.status} />
                    </View>
                  </Pressable>
                ))}
              </Card>
            )}
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
  },
  title: {
    flex: 1,
  },
  nav: {
    flexDirection: "row",
    alignItems: "center",
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
  },
  weekdays: {
    width: "100%",
    flexDirection: "row",
    marginBottom: 4,
  },
  weekday: {
    flex: 1,
    textAlign: "center",
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
    alignItems: "center",
    justifyContent: "center",
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
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: 10,
  },
});
