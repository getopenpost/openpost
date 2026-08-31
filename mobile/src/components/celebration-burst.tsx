import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";

const COLORS = ["#b74c05", "#f18a3b", "#ffd6ad", "#fff7ed"];
const DURATION_MS = 900;
const PARTICLES = Array.from({ length: 24 }, (_, index) => {
  const angle = (index / 24) * Math.PI * 2;
  const distance = 82 + (index % 5) * 13;
  return {
    color: COLORS[index % COLORS.length],
    height: index % 3 === 0 ? 10 : 7,
    rotation: 160 + (index % 7) * 38,
    width: index % 2 === 0 ? 6 : 9,
    x: Math.cos(angle) * distance,
    y: 90 + Math.abs(Math.sin(angle)) * 86,
  };
});

export function CelebrationBurst({ trigger }: { trigger: number }) {
  const [progress] = useState(() => new Animated.Value(0));
  const previousTrigger = useRef(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (trigger <= previousTrigger.current) return;
    previousTrigger.current = trigger;
    let cancelled = false;

    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled || reduceMotion) return;
      progress.stopAnimation();
      progress.setValue(0);
      setVisible(true);
      Animated.timing(progress, {
        duration: DURATION_MS,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && !cancelled) setVisible(false);
      });
    });

    return () => {
      cancelled = true;
      progress.stopAnimation();
    };
  }, [progress, trigger]);

  if (!visible) return null;

  return (
    <View pointerEvents="none" style={styles.overlay} accessibilityElementsHidden>
      {PARTICLES.map((particle, index) => (
        <Animated.View
          key={index}
          style={[
            styles.particle,
            {
              backgroundColor: particle.color,
              height: particle.height,
              width: particle.width,
              opacity: progress.interpolate({
                inputRange: [0, 0.72, 1],
                outputRange: [1, 1, 0],
              }),
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, particle.x],
                  }),
                },
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 0.35, 1],
                    outputRange: [0, -44, particle.y],
                  }),
                },
                {
                  rotate: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0deg", `${particle.rotation}deg`],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 100,
  },
  particle: {
    borderRadius: 2,
    left: "50%",
    position: "absolute",
    top: 150,
  },
});
