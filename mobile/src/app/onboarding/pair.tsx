import * as WebBrowser from "expo-web-browser";
import { router, Stack, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, ScrollView, StyleSheet, Text, View } from "react-native";

import { BodyText, Button, Card, Screen, useColors } from "@/components/ui";
import { Brand } from "@/components/brand";
import { pollPairing, startPairing } from "@/lib/auth";
import { successHaptic } from "@/lib/haptics";
import { isAbortError, waitForPairingResult } from "@/lib/pairing-loop";

type Phase = "starting" | "waiting" | "approved" | "denied" | "expired" | "error";

export default function PairScreen() {
  const colors = useColors();
  const [phase, setPhase] = useState<Phase>("starting");
  const [userCode, setUserCode] = useState("");
  const [verificationUrl, setVerificationUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const attemptRef = useRef(attempt);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        returnToLogin();
        return true;
      });
      return () => subscription.remove();
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      const attemptId = attempt;
      const isCancelled = () => controller.signal.aborted || attemptRef.current !== attemptId;
      let navigationTimer: ReturnType<typeof setTimeout> | undefined;
      void (async () => {
        try {
          const state = await startPairing("OpenPost Mobile", controller.signal);
          if (isCancelled()) return;
          setUserCode(state.userCode);
          setVerificationUrl(state.verificationUrl);
          setPhase("waiting");
          const result = await waitForPairingResult({
            deviceCode: state.deviceCode,
            isCancelled,
            poll: (deviceCode) => pollPairing(deviceCode, controller.signal),
          });
          if (!result || isCancelled()) return;
          if (result.status === "approved") {
            void successHaptic();
            setPhase("approved");
            navigationTimer = setTimeout(() => router.replace("/"), 500);
          } else {
            setPhase(result.status);
          }
        } catch (err) {
          if (!isCancelled()) {
            setPhase("error");
            setError(
              isAbortError(err)
                ? "Your sign-in session changed. Get a new pairing code."
                : err instanceof Error
                  ? err.message
                  : "Could not start pairing",
            );
          }
        }
      })();
      return () => {
        controller.abort();
        if (navigationTimer) clearTimeout(navigationTimer);
      };
    }, [attempt]),
  );

  function restart() {
    setError(null);
    setPhase("starting");
    setUserCode("");
    setVerificationUrl("");
    setAttempt((current) => {
      const next = current + 1;
      attemptRef.current = next;
      return next;
    });
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
        <Text style={[styles.title, { color: colors.onSurface }]}>{title}</Text>
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
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text
                  accessibilityLabel={`Pairing code ${userCode}`}
                  adjustsFontSizeToFit
                  minimumFontScale={0.55}
                  numberOfLines={1}
                  style={[styles.code, { color: colors.onSurface }]}
                  selectable
                >
                  {userCode}
                </Text>
              )}
            </Card>
            <BodyText style={styles.center}>Enter this code at</BodyText>
            <BodyText style={[styles.center, styles.url, { color: colors.onSurface }]}>
              {verificationUrl.replace(/^https?:\/\//, "").replace(/\?.*$/, "")}
            </BodyText>
            <Button
              title="Open verification page"
              intent="focal"
              onPress={() => void WebBrowser.openBrowserAsync(verificationUrl)}
              style={styles.openButton}
            />
            <View accessibilityLiveRegion="polite" style={styles.waitRow}>
              <ActivityIndicator color={colors.primary} />
              <BodyText>Waiting for approval</BodyText>
            </View>
          </>
        ) : null}

        {phase === "approved" ? (
          <View accessibilityRole="alert" style={styles.approved}>
            <ActivityIndicator color={colors.status.published} />
            <BodyText style={{ color: colors.status.published }}>This device is ready.</BodyText>
          </View>
        ) : null}

        {phase === "denied" || phase === "expired" || phase === "error" ? (
          <>
            {error ? (
              <BodyText accessibilityRole="alert" style={[styles.center, { color: colors.error }]}>
                {error}
              </BodyText>
            ) : null}
            <Button
              title="Get a new code"
              intent="ordinary"
              onPress={() => void restart()}
              style={styles.openButton}
            />
          </>
        ) : null}

        <Button
          title="Back to sign in"
          intent="quiet"
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
