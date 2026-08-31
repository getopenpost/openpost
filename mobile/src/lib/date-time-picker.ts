export type PickerPlatform = "android" | "ios";
export type PickerStep = "date" | "time" | "datetime";

export function firstPickerStep(_platform: PickerPlatform): PickerStep {
  return _platform === "android" ? "date" : "datetime";
}
export function applyPickerValue(
  current: Date,
  picked: Date,
  step: PickerStep,
): { value: Date; nextStep: PickerStep | null } {
  if (step === "datetime") return { value: picked, nextStep: null };

  const value = new Date(current);
  if (step === "date") {
    value.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    return { value, nextStep: "time" };
  }

  value.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  return { value, nextStep: null };
}
