import { router, Stack } from "expo-router";
import { useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";
import {
  Button,
  ContentSection,
  ContentTitle,
  IconButton,
  PageTitle,
  Screen,
  StatusBadge,
} from "@/components/ui";
import { calendarWeeks, shiftCalendarMonth } from "@/lib/calendar";
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
  const { width, fontScale } = useWindowDimensions();
  const stackedMonthControls = width < 480 || fontScale >= 1.4;
  const { colors, shape, spacing, typography } = theme.manifest;
  const today = useMemo(() => new Date(), []);
  const [selectedDate, setSelectedDate] = useState(() => today);
  const month = useMemo(
    () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
    [selectedDate],
  );
  const selectedDay = dayKey(selectedDate);

  const monthStart = month;
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const publications = useCalendarPublications(monthStart.toISOString(), monthEnd.toISOString());

  const byDay = useMemo(() => {
    const map = new Map<string, { id: string; title: string; status: string; time: Date }[]>();
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
        time: date,
      });
      map.set(key, list);
    }
    for (const items of map.values()) items.sort((a, b) => a.time.getTime() - b.time.getTime());
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
    setSelectedDate((current) => shiftCalendarMonth(current, delta));
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
        <PageTitle style={styles.title}>Calendar</PageTitle>
        <IconButton label="Write a post" role="add" onPress={() => router.push("/(tabs)/drafts")} />
      </View>
      <View
        style={[
          styles.header,
          { paddingHorizontal: spacing.extraLarge, paddingBottom: spacing.small },
          stackedMonthControls && {
            flexDirection: "column",
            alignItems: "flex-start",
            gap: spacing.small,
          },
        ]}
      >
        <ContentTitle style={[styles.title, stackedMonthControls && { flex: 0 }]}>
          {month.toLocaleDateString("en", { month: "long", year: "numeric" })}
        </ContentTitle>
        <View style={[styles.nav, { gap: spacing.extraSmall }]}>
          <IconButton
            label="Previous month"
            role="back"
            color={colors.primary}
            onPress={() => shiftMonth(-1)}
          />
          <Button
            title="Today"
            intent="ordinary"
            style={{ paddingHorizontal: spacing.medium }}
            onPress={() => setSelectedDate(new Date())}
          />
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
                  style={[
                    styles.weekday,
                    typography.labelMedium,
                    { color: colors.onSurfaceVariant },
                  ]}
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
                        onPress={() => setSelectedDate(date)}
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

            <ContentSection style={[styles.daySheet, { gap: spacing.medium }]}>
              <ContentTitle>{selectedDayTitle}</ContentTitle>
              {selectedItems.length === 0 ? (
                <View style={{ gap: spacing.medium, alignItems: "flex-start" }}>
                  <Text style={[typography.bodyLarge, { color: colors.onSurfaceVariant }]}>
                    Nothing planned.
                  </Text>
                  <Button title="Write a post" onPress={() => router.push("/(tabs)/drafts")} />
                </View>
              ) : (
                selectedItems.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.time.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}, ${item.title}, ${item.status}`}
                    onPress={() =>
                      router.push({ pathname: "/publications/[id]", params: { id: item.id } })
                    }
                    style={({ pressed }) => [
                      styles.itemRow,
                      {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.outlineVariant,
                        paddingVertical: spacing.medium,
                      },
                      pressed && { opacity: 0.5 },
                    ]}
                  >
                    <Text
                      style={[
                        typography.labelLarge,
                        { color: colors.onSurfaceVariant, minWidth: 56 },
                      ]}
                    >
                      {item.time.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                    </Text>
                    <View style={{ flex: 1, gap: spacing.small }}>
                      <Text
                        style={[typography.bodyLarge, { color: colors.onSurface }]}
                        numberOfLines={2}
                      >
                        {item.title}
                      </Text>
                      <StatusBadge status={item.status} />
                    </View>
                  </Pressable>
                ))
              )}
            </ContentSection>
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
