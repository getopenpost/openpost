import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export function pressHaptic(): Promise<void> {
  if (Platform.OS === "android") {
    return Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Virtual_Key);
  }
  return Haptics.selectionAsync();
}

export function selectionHaptic(): Promise<void> {
  if (Platform.OS === "android") {
    return Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick);
  }
  return Haptics.selectionAsync();
}

export function successHaptic(): Promise<void> {
  if (Platform.OS === "android") {
    return Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm);
  }
  return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function errorHaptic(): Promise<void> {
  if (Platform.OS === "android") {
    return Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject);
  }
  return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}
