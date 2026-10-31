// Web-only presentation adapters for native modules, used only by screenshot Metro.
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type PropsWithChildren,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
export function BottomSheetProvider({ children }: PropsWithChildren) {
  return children;
}
export function ModalBottomSheet({
  index,
  children,
  surface,
}: PropsWithChildren<{ index: number; surface?: ReactNode }>) {
  return index > 0 ? (
    <View style={[StyleSheet.absoluteFill, { zIndex: 50 }]}>
      {surface}
      {children}
    </View>
  ) : null;
}
export const KeyboardAwareScrollView = forwardRef<ScrollView, ComponentProps<typeof ScrollView>>(
  (props, ref) => {
    const scroll = useRef<ScrollView>(null);
    useImperativeHandle(ref, () =>
      Object.assign(scroll.current!, { assureFocusedInputVisible() {} }),
    );
    return <ScrollView {...props} ref={scroll} />;
  },
);
export function useReanimatedKeyboardAnimation() {
  return { height: useSharedValue(0), progress: useSharedValue(0) };
}
export function KeyboardProvider({ children }: PropsWithChildren) {
  return children;
}
