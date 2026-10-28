import { describe, expect, test } from "bun:test";

import {
  MINIMUM_FOCUS_CONTRAST,
  MINIMUM_SEMANTIC_ACTION_DISTANCE,
  MINIMUM_STATUS_COLOR_DISTANCE,
  MINIMUM_TEXT_CONTRAST,
  balancedDitherAction,
  compositeValidationColor,
  compositedContrastRatio,
  contrastRatio,
  oklabDistance,
  type ThemeValidationRgba,
} from "./theme-validation";

function rgba(tuple: readonly [number, number, number, number]): ThemeValidationRgba {
  return { red: tuple[0], green: tuple[1], blue: tuple[2], alpha: tuple[3] };
}

const BLACK = rgba([0, 0, 0, 1]);
const WHITE = rgba([1, 1, 1, 1]);
const HALF_BLACK = rgba([0, 0, 0, 0.5]);

describe("shared theme validation thresholds", () => {
  test("keeps the accessibility and dither contract values", () => {
    expect(MINIMUM_TEXT_CONTRAST).toBe(4.5);
    expect(MINIMUM_FOCUS_CONTRAST).toBe(3);
    expect(MINIMUM_SEMANTIC_ACTION_DISTANCE).toBe(0.014);
    expect(MINIMUM_STATUS_COLOR_DISTANCE).toBe(0.04);
  });
});

describe("shared contrast math", () => {
  test("rates opaque light-on-dark and dark-on-light pairs at 21:1", () => {
    expect(contrastRatio(WHITE, BLACK)).toBe(21);
    expect(contrastRatio(BLACK, WHITE)).toBe(21);
  });

  test("composites a translucent foreground over its underlay before comparing", () => {
    const ratio = compositedContrastRatio(HALF_BLACK, WHITE, WHITE);
    expect(ratio).toBeGreaterThan(3.9);
    expect(ratio).toBeLessThan(4.1);
  });

  test("composites one translucent layer over another without a shortcut", () => {
    const composited = compositeValidationColor(HALF_BLACK, WHITE);
    expect(composited).toEqual({ red: 0.5, green: 0.5, blue: 0.5, alpha: 1 });
    const translucent = compositeValidationColor(HALF_BLACK, rgba([1, 1, 1, 0.5]));
    expect(translucent.alpha).toBe(0.75);
    expect(translucent.red).toBeCloseTo(1 / 3, 12);
    expect(translucent.green).toBeCloseTo(1 / 3, 12);
    expect(translucent.blue).toBeCloseTo(1 / 3, 12);
  });
});

describe("shared perceptual distance", () => {
  test("rates black and white about one Oklab unit apart", () => {
    const distance = oklabDistance(BLACK, WHITE, WHITE);
    expect(distance).toBeDefined();
    expect(distance!).toBeGreaterThan(0.99);
    expect(distance!).toBeLessThan(1.01);
  });

  test("rejects a translucent underlay instead of guessing", () => {
    expect(oklabDistance(BLACK, WHITE, HALF_BLACK)).toBeUndefined();
  });
});

describe("shared dither balance", () => {
  test("accepts dark ink mixed into a light fill over white", () => {
    expect(balancedDitherAction(BLACK, rgba([0.9, 0.9, 0.9, 1]), WHITE)).toBe(true);
  });

  test("rejects ink that disappears into its own texture", () => {
    expect(balancedDitherAction(WHITE, WHITE, WHITE)).toBe(false);
  });
});
