import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
} from "react-native";
import { SvgXml } from "react-native-svg";
import { useReducedMotion } from "react-native-reanimated";
import { DITHER_BUTTON_OPACITY, gradientSvg } from "@openpost/dither/paint";

const INTERACTION_STEPS = 16;
const PRESS_INTENSITY = 1.5;
const TRANSITION_MS = 160;

/** Native input drives the shared Bayer material, without frames running at rest. */
export function DitherPressable({
  children,
  radius,
  textureInk,
  textureOpacity = DITHER_BUTTON_OPACITY,
  focusColor,
  ...props
}: PressableProps & {
  radius: number;
  textureInk?: string;
  textureOpacity?: number;
  focusColor: string;
}) {
  const initialReducedMotion = useReducedMotion();
  const [reducedMotion, setReducedMotion] = useState(initialReducedMotion);
  useEffect(() => {
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => subscription.remove();
  }, []);
  const [progress] = useState(() => new Animated.Value(0));
  const [step, setStep] = useState(0);
  const [height, setHeight] = useState(0);
  const [focused, setFocused] = useState(false);
  const ink = textureInk;
  const opacity = textureOpacity;
  const interaction = useRef({ hovered: false, focused: false, pressed: false });
  const frames = useMemo(
    () =>
      height && ink
        ? Array.from({ length: INTERACTION_STEPS + 1 }, (_, index) =>
            gradientSvg({
              length: height,
              kind: "button",
              direction: "up",
              intensity: (index / INTERACTION_STEPS) * PRESS_INTENSITY,
              ink,
            }),
          )
        : [],
    [height, ink],
  );

  useEffect(() => {
    const subscription = progress.addListener(({ value }) =>
      setStep(Math.round((value * INTERACTION_STEPS) / PRESS_INTENSITY)),
    );
    return () => {
      progress.stopAnimation();
      progress.removeListener(subscription);
    };
  }, [progress]);

  function settle() {
    const { hovered, focused, pressed } = interaction.current;
    const target = props.disabled ? 0 : pressed ? PRESS_INTENSITY : hovered || focused ? 1 : 0;
    progress.stopAnimation();
    if (reducedMotion) progress.setValue(target);
    else
      Animated.timing(progress, {
        toValue: target,
        duration: TRANSITION_MS,
        easing: Easing.out(Easing.exp),
        useNativeDriver: false,
      }).start();
  }

  useEffect(() => {
    if (props.disabled) {
      interaction.current.pressed = false;
      progress.stopAnimation();
      progress.setValue(0);
    }
  }, [props.disabled, progress]);

  return (
    <Pressable
      {...props}
      onLayout={(event) => {
        setHeight(Math.ceil(event.nativeEvent.layout.height));
        props.onLayout?.(event);
      }}
      onHoverIn={(event) => {
        interaction.current.hovered = true;
        settle();
        props.onHoverIn?.(event);
      }}
      onHoverOut={(event) => {
        interaction.current.hovered = false;
        settle();
        props.onHoverOut?.(event);
      }}
      onFocus={(event) => {
        setFocused(true);
        interaction.current.focused = true;
        settle();
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        interaction.current.focused = false;
        settle();
        props.onBlur?.(event);
      }}
      onPressIn={(event) => {
        interaction.current.pressed = true;
        settle();
        props.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        interaction.current.pressed = false;
        settle();
        props.onPressOut?.(event);
      }}
    >
      {(state) => (
        <>
          {!props.disabled && frames.length ? (
            <View
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { borderRadius: radius, overflow: "hidden", opacity },
              ]}
            >
              <SvgXml
                xml={`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${height}"><defs><pattern id="dither" width="8" height="${height}" patternUnits="userSpaceOnUse">${frames[step]}</pattern></defs><rect width="100%" height="${height}" fill="url(#dither)"/></svg>`}
                width="100%"
                height={height}
              />
            </View>
          ) : null}
          {focused ? (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { borderRadius: radius, borderColor: focusColor, borderWidth: 2 },
              ]}
            />
          ) : null}
          {typeof children === "function" ? children(state) : children}
        </>
      )}
    </Pressable>
  );
}
