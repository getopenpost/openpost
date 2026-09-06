export function drawerBottomPadding(restingPadding: number, keyboardTranslation: number) {
  "worklet";
  return restingPadding + Math.max(0, -keyboardTranslation);
}
