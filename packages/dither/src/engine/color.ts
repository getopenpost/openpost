import { cssColor } from "./tokens.js";
import type { DitherColor, Rgba } from "./tokens.js";

// OpenPost cells are 2 CSS pixels unless `--dither-cell` says otherwise.
const DEFAULT_CELL = 2;

let probe: CanvasRenderingContext2D | null = null;

const getProbe = () => {
  if (!probe) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d", { willReadFrequently: true });
  }
  return probe;
};

/**
 * Resolve a colour to sRGB. CSS variables resolve in the context of `el`
 * (the document root by default), so scoped overrides apply. Any format
 * the browser understands works, including oklch, because the colour is
 * painted into a 1x1 canvas and read back.
 */
export const resolveColor = (value: DitherColor, el?: Element | null): Rgba => {
  const host = el ?? document.documentElement;
  const span = document.createElement("span");
  span.style.color = cssColor(value);
  span.style.display = "none";
  host.append(span);
  const { color } = getComputedStyle(span);
  span.remove();

  const context = getProbe();
  if (!context) {
    return [0, 0, 0, 1];
  }
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255, a / 255];
};

/** The dither cell size in CSS pixels, read from `--dither-cell` on `el`. */
export const readDitherCell = (el?: Element | null): number => {
  const host = el ?? document.documentElement;
  const value = Number.parseFloat(getComputedStyle(host).getPropertyValue("--dither-cell"));
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CELL;
};

const themeListeners = new Set<() => void>();
let themeObserver: MutationObserver | null = null;

/**
 * Call `listener` whenever the class or style of `<html>` changes, which is
 * how next-themes and most theme switchers swap palettes. One observer is
 * shared by every subscriber. Returns the unsubscribe function.
 */
export const subscribeToTheme = (listener: () => void): (() => void) => {
  themeListeners.add(listener);
  if (!themeObserver) {
    themeObserver = new MutationObserver(() => {
      for (const notify of themeListeners) {
        notify();
      }
    });
    themeObserver.observe(document.documentElement, {
      attributeFilter: ["class", "style", "data-theme", "data-theme-id", "data-theme-decoration"],
      attributes: true,
    });
  }
  return () => {
    themeListeners.delete(listener);
    if (themeListeners.size === 0) {
      themeObserver?.disconnect();
      themeObserver = null;
    }
  };
};

/**
 * Resolve `names` now and again whenever the theme changes. Returns the
 * unsubscribe function. Framework adapters wrap this in their own state.
 */
export const watchDitherColors = (
  names: readonly DitherColor[],
  el: Element | null | undefined,
  onChange: (colors: readonly Rgba[]) => void,
): (() => void) => {
  const read = () => onChange(names.map((name) => resolveColor(name, el)));
  read();
  return subscribeToTheme(read);
};
