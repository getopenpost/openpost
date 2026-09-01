import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { BodyText, Button, Card, Screen, useColors } from "./ui";
import { Brand } from "./brand";
import { COLD_LOAD_DELAY_MS } from "../lib/query-presentation";

type QueryPlaceholderShape = "launch" | "list" | "calendar" | "detail" | "editor";

export function DelayedQueryPlaceholder({
  pending,
  shape = "list",
  offline = false,
}: {
  pending: boolean;
  shape?: QueryPlaceholderShape;
  offline?: boolean;
}) {
  if (!pending) return null;
  return <DelayedPlaceholderContent shape={shape} offline={offline} />;
}

function DelayedPlaceholderContent({
  shape,
  offline,
}: {
  shape: QueryPlaceholderShape;
  offline: boolean;
}) {
  const visible = useDelayedVisibility();
  if (!visible) return null;
  return <QueryPlaceholder shape={shape} offline={offline} />;
}

export function LaunchPlaceholder({ pending, offline }: { pending: boolean; offline: boolean }) {
  return (
    <Screen>
      <View style={styles.launchContent}>
        <Brand compact style={styles.brand} />
        <DelayedQueryPlaceholder pending={pending} shape="launch" offline={offline} />
      </View>
    </Screen>
  );
}

export function QueryNotice({
  message,
  retry,
  offline = false,
}: {
  message: string;
  retry?: () => void;
  offline?: boolean;
}) {
  const colors = useColors();
  return (
    <Card
      accessibilityLiveRegion="polite"
      style={[styles.notice, offline && { backgroundColor: colors.tintSoft }]}
    >
      <BodyText accessibilityRole={offline ? undefined : "alert"}>{message}</BodyText>
      {retry ? (
        <Button title="Try again" variant="tinted" onPress={retry} style={styles.retry} />
      ) : null}
    </Card>
  );
}

export function InitialQueryError({
  title,
  message,
  retry,
  secondaryAction,
}: {
  title: string;
  message: string;
  retry: () => void;
  secondaryAction?: { label: string; onPress: () => void };
}) {
  const colors = useColors();
  return (
    <Card style={styles.error}>
      <Text accessibilityRole="header" style={[styles.errorTitle, { color: colors.text }]}>
        {title}
      </Text>
      <BodyText accessibilityRole="alert">{message}</BodyText>
      <Button title="Try again" variant="tinted" onPress={retry} />
      {secondaryAction ? (
        <Button title={secondaryAction.label} variant="plain" onPress={secondaryAction.onPress} />
      ) : null}
    </Card>
  );
}

function QueryPlaceholder({ shape, offline }: { shape: QueryPlaceholderShape; offline: boolean }) {
  const colors = useColors();
  if (shape === "calendar") {
    return (
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={offline ? "Waiting for a connection" : "Loading content"}
        style={styles.placeholder}
      >
        <View style={styles.calendarWeekdays}>
          {Array.from({ length: 7 }, (_, index) => (
            <View
              key={index}
              style={[styles.calendarWeekday, { backgroundColor: colors.inputBg }]}
            />
          ))}
        </View>
        <View style={styles.calendarGrid}>
          {Array.from({ length: 5 }, (_, week) => (
            <View key={week} style={styles.calendarWeek}>
              {Array.from({ length: 7 }, (_, day) => (
                <View key={day} style={[styles.calendarDay, { backgroundColor: colors.inputBg }]} />
              ))}
            </View>
          ))}
        </View>
        <View
          style={[
            styles.placeholderCard,
            { backgroundColor: colors.card, borderColor: colors.separator },
          ]}
        >
          <View style={[styles.linePlaceholder, { backgroundColor: colors.inputBg }]} />
          <View
            style={[styles.linePlaceholder, styles.shortLine, { backgroundColor: colors.inputBg }]}
          />
        </View>
        {offline ? <BodyText style={styles.offline}>Waiting for a connection.</BodyText> : null}
      </View>
    );
  }
  const cardCount = shape === "detail" ? 2 : 3;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={offline ? "Waiting for a connection" : "Loading content"}
      style={styles.placeholder}
    >
      <View style={[styles.titlePlaceholder, { backgroundColor: colors.inputBg }]} />
      {Array.from({ length: cardCount }, (_, index) => (
        <View
          key={index}
          style={[
            styles.placeholderCard,
            { backgroundColor: colors.card, borderColor: colors.separator },
            shape === "editor" && index === 0 && styles.editorCard,
          ]}
        >
          <View
            style={[
              styles.linePlaceholder,
              { backgroundColor: colors.inputBg },
              index === cardCount - 1 && styles.shortLine,
            ]}
          />
          <View
            style={[styles.linePlaceholder, styles.shortLine, { backgroundColor: colors.inputBg }]}
          />
        </View>
      ))}
      {offline ? <BodyText style={styles.offline}>Waiting for a connection.</BodyText> : null}
    </View>
  );
}

function useDelayedVisibility(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => setVisible(true), COLD_LOAD_DELAY_MS);
    return () => clearTimeout(timeout);
  }, []);
  return visible;
}

const styles = StyleSheet.create({
  launchContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  brand: {
    marginBottom: 28,
  },
  placeholder: {
    gap: 12,
  },
  titlePlaceholder: {
    width: "44%",
    height: 28,
    borderRadius: 8,
    marginBottom: 4,
  },
  placeholderCard: {
    minHeight: 76,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 10,
  },
  calendarWeekdays: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-around",
  },
  calendarWeekday: {
    borderRadius: 3,
    height: 6,
    width: 18,
  },
  calendarGrid: {
    gap: 10,
    paddingVertical: 6,
  },
  calendarWeek: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  calendarDay: {
    borderRadius: 14,
    height: 28,
    width: 28,
  },
  editorCard: {
    minHeight: 150,
  },
  linePlaceholder: {
    height: 13,
    borderRadius: 6,
    width: "84%",
  },
  shortLine: {
    width: "52%",
  },
  offline: {
    paddingTop: 4,
    textAlign: "center",
  },
  notice: {
    gap: 10,
    marginBottom: 10,
  },
  retry: {
    alignSelf: "flex-start",
    minWidth: 120,
  },
  error: {
    gap: 12,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
});
