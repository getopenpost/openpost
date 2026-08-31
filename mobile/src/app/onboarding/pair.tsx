import * as WebBrowser from "expo-web-browser";
import { router, Stack, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, ScrollView, StyleSheet, Text, View } from "react-native";

import { BodyText, Button, Card, Screen, useColors } from "@/components/ui";
import { Brand } from "@/components/brand";
import { pollPairing, startPairing } from "@/lib/auth";
import { successHaptic } from "@/lib/haptics";

type Phase = "starting" | "waiting" | "approved" | "denied" | "expired" | "error";

export default function PairScreen() {
  const colors = useColors();
  const [phase, setPhase] = useState<Phase>("starting");
  const [userCode, setUserCode] = useState("");
  const [verificationUrl, setVerificationUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const deviceCode = useRef("");
  const cancelled = useRef(false);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        returnToLogin();
        return true;
      });
      return () => subscription.remove();
    }, []),
  );

  useEffect(() => {
    cancelled.current = false;
    void (async () => {
      try {
        const state = await startPairing();
        if (cancelled.current) return;
        deviceCode.current = state.deviceCode;
        setUserCode(state.userCode);
        setVerificationUrl(state.verificationUrl);
        setPhase("waiting");
        while (!cancelled.current) {
          try {
            const result = await pollPairing(deviceCode.current);
            if (cancelled.current) return;
            if (result.status === "pending") {
              await sleep(result.intervalMs);
              continue;
            }
            if (result.status === "approved") {
              void successHaptic();
              setPhase("approved");
              setTimeout(() => router.replace("/onboarding/workspace"), 500);
            } else {
              setPhase(result.status);
            }
            return;
          } catch {
            await sleep(3000);
          }
        }
      } catch (err) {
        if (!cancelled.current) {
          setPhase("error");
          setError(err instanceof Error ? err.message : "Could not start pairing");
        }
      }
    })();
    return () => {
      cancelled.current = true;
    };
  }, [attempt]);

  async function restart() {
    setError(null);
    setPhase("starting");
    setUserCode("");
    setVerificationUrl("");
    setAttempt((current) => current + 1);
  }

  const title =
    phase === "approved"
      ? "Paired!"
      : phase === "denied"
        ? "Pairing denied"
        : phase === "expired"
          ? "Code expired"
          : phase === "error"
            ? "Something went wrong"
            : "Pair this device";

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Brand compact style={styles.brand} />
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {phase !== "approved" ? (
          <BodyText style={styles.subtitle}>
            Approve this device from a browser where you are signed in. Organizations that use
            single sign-on should pair this way.
          </BodyText>
        ) : null}

        {phase === "starting" || phase === "waiting" ? (
          <>
            <Card style={styles.codeCard}>
              {phase === "starting" ? (
                <ActivityIndicator color={colors.tint} />
              ) : (
                <Text
                  accessibilityLabel={`Pairing code ${userCode}`}
                  adjustsFontSizeToFit
                  minimumFontScale={0.55}
                  numberOfLines={1}
                  style={[styles.code, { color: colors.text }]}
                  selectable
                >
                  {userCode}
                </Text>
              )}
            </Card>
            <BodyText style={styles.center}>Enter this code at</BodyText>
            <BodyText style={[styles.center, styles.url, { color: colors.text }]}>
              {verificationUrl.replace(/^https?:\/\//, "").replace(/\?.*$/, "")}
            </BodyText>
            <Button
              title="Open verification page"
              variant="focal"
              onPress={() => void WebBrowser.openBrowserAsync(verificationUrl)}
              style={styles.openButton}
            />
            <View accessibilityLiveRegion="polite" style={styles.waitRow}>
              <ActivityIndicator color={colors.tint} />
              <BodyText>Waiting for approval</BodyText>
            </View>
          </>
        ) : null}

        {phase === "approved" ? (
          <View accessibilityRole="alert" style={styles.approved}>
            <ActivityIndicator color={colors.success} />
            <BodyText style={{ color: colors.success }}>This device is ready.</BodyText>
          </View>
        ) : null}

        {phase === "denied" || phase === "expired" || phase === "error" ? (
          <>
            {error ? (
              <BodyText accessibilityRole="alert" style={[styles.center, { color: colors.danger }]}>
                {error}
              </BodyText>
            ) : null}
            <Button
              title="Try again"
              variant="tinted"
              onPress={() => void restart()}
              style={styles.openButton}
            />
          </>
        ) : null}

        <Button
          title="Back to sign in"
          variant="plain"
          onPress={returnToLogin}
          style={styles.backButton}
        />
      </ScrollView>
    </Screen>
  );
}

function returnToLogin() {
  router.replace("/onboarding/login");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 40,
  },
  brand: {
    marginBottom: 28,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  subtitle: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  codeCard: {
    alignItems: "center",
    paddingVertical: 24,
  },
  code: {
    fontSize: 40,
    fontWeight: "800",
    letterSpacing: 6,
  },
  center: {
    textAlign: "center",
    marginTop: 12,
  },
  url: {
    fontWeight: "600",
  },
  openButton: {
    marginTop: 16,
  },
  waitRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  approved: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 24,
  },
  backButton: {
    marginTop: 12,
  },
});
