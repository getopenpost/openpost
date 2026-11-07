/**
 * Pure helpers behind the cartesian charts (area, line, bar): accessors,
 * scales, curves and plot layout. Ported from dithercn's `cartesian-chart`
 * (MIT); the Svelte frame lives in `cartesian-chart.svelte`.
 */
import { SERIES_COLORS } from "@openpost/dither/engine";
import type { DitherColor } from "@openpost/dither/engine";

/** The keys of `T` whose values are assignable to `V`. */
export type KeyOfType<T, V> = {
  [K in keyof T]-?: T[K] extends V ? K : never;
}[keyof T];

/** Where a chart reads a field: a key of the datum, or a function. */
export type Accessor<T, V> = KeyOfType<T, V> | ((datum: T) => V);

export const readLabel = <T>(datum: T, accessor: Accessor<T, string | number>): string =>
  String(typeof accessor === "function" ? accessor(datum) : datum[accessor]);

/** A value, as a number. Anything that is not a finite number reads as 0. */
export const readValue = <T>(datum: T, accessor: Accessor<T, number>) => {
  const raw = typeof accessor === "function" ? accessor(datum) : datum[accessor];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
};

/** `Intl.NumberFormat` options or a function. */
export type ValueFormat = Intl.NumberFormatOptions | ((value: number) => string);

const COMPACT: Intl.NumberFormatOptions = { maximumFractionDigits: 1, notation: "compact" };

/** A formatter for a `ValueFormat`. Default compact, as in 1.2K. */
export const toFormatter = (
  format: ValueFormat = COMPACT,
  locale?: string,
): ((value: number) => string) => {
  if (typeof format === "function") return format;
  const formatter = new Intl.NumberFormat(locale, format);
  return (value) => formatter.format(value);
};

/** One value read from every datum, drawn as one line, area or bar set. */
export interface ChartSeries<T> {
  label: string;
  value: Accessor<T, number>;
  color?: DitherColor;
}

export type NonEmpty<T> = readonly [T, ...T[]];

/** The colour series `index` draws in: its own, then the chart's `colors`, then the palette. */
export const seriesColor = (
  color: DitherColor | undefined,
  index: number,
  colors: readonly DitherColor[] = [],
): DitherColor => color ?? colors[index] ?? SERIES_COLORS[index % SERIES_COLORS.length] ?? "ink";

/** Snap a length to whole device pixels so dither cells stay sharp. */
export const snapToDevice = (px: number, dpr: number) => Math.max(1, Math.round(px * dpr)) / dpr;

/** Round a dither level to whole cells of a 4×4 tile so it renders exactly. */
export const quantizeLevel = (level: number) =>
  Math.round(Math.min(1, Math.max(0, level)) * 16) / 16;

const NICE_STEPS = [1, 2, 2.5, 5, 10];

export interface Scale {
  min: number;
  max: number;
  ticks: readonly number[];
}

/** A y domain with round ticks that covers every value; with `zero` it includes zero. */
export const niceScale = (
  values: readonly number[],
  { zero = true, count = 4 }: { zero?: boolean; count?: number } = {},
): Scale => {
  const finite = values.filter((value) => Number.isFinite(value));
  const floor = zero ? [0] : [];
  const low = finite.length > 0 ? Math.min(...floor, ...finite) : 0;
  const high = finite.length > 0 ? Math.max(...floor, ...finite) : 1;
  const span = high - low || Math.abs(high) || 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = (NICE_STEPS.find((candidate) => candidate * magnitude >= raw) ?? 10) * magnitude;
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step)
    ticks.push(Number(tick.toPrecision(12)));
  return { max, min, ticks };
};

export interface Point {
  x: number;
  y: number;
}

export const linearPath = (points: readonly Point[]) =>
  points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join("");

/** A smooth curve that never overshoots its points (monotone cubic, Fritsch–Carlson). */
export const monotonePath = (points: readonly Point[]) => {
  const count = points.length;
  if (count < 3) return linearPath(points);
  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    slopes.push(a && b ? (b.y - a.y) / (b.x - a.x || 1) : 0);
  }
  const tangents = points.map((_, index) => {
    const before = slopes[index - 1];
    const after = slopes[index];
    if (before === undefined) return after ?? 0;
    if (after === undefined) return before;
    return before * after <= 0 ? 0 : (before + after) / 2;
  });
  for (let index = 0; index < count - 1; index += 1) {
    const slope = slopes[index] ?? 0;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
    } else {
      const a = (tangents[index] ?? 0) / slope;
      const b = (tangents[index + 1] ?? 0) / slope;
      const length = a * a + b * b;
      if (length > 9) {
        const scale = 3 / Math.sqrt(length);
        tangents[index] = scale * a * slope;
        tangents[index + 1] = scale * b * slope;
      }
    }
  }
  let path = "";
  for (let index = 0; index < count; index += 1) {
    const point = points[index];
    const previous = points[index - 1];
    if (point === undefined) break;
    if (previous === undefined) {
      path += `M${point.x} ${point.y}`;
    } else {
      const third = (point.x - previous.x) / 3;
      const start = tangents[index - 1] ?? 0;
      const end = tangents[index] ?? 0;
      path += `C${previous.x + third} ${previous.y + start * third} ${point.x - third} ${point.y - end * third} ${point.x} ${point.y}`;
    }
  }
  return path;
};

export interface Plot {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** What every chart's marks are drawn from. */
export interface ChartContext {
  uid: string;
  width: number;
  height: number;
  cell: number;
  plot: Plot;
  xAt: (index: number) => number;
  band: number;
  yAt: (value: number) => number;
  /** Entrance progress, 0 → 1. */
  reveal: number;
  animate: boolean;
  focus: number | null;
  scrubbing: boolean;
  colorOf: (index: number) => DitherColor;
  opacityOf: (index: number) => number;
}

export interface ScrubPoint {
  seriesIndex: number;
  y: number;
}

export interface ReadoutRow {
  label: string;
  color: DitherColor;
  value: string;
}

const AXIS_FONT_WIDTH = 6.1;
export const DIMMED = 0.18;

export const layoutPlot = ({
  axes,
  count,
  formatTick,
  height,
  layout,
  scale,
  width,
}: {
  axes: boolean;
  count: number;
  formatTick: (value: number) => string;
  height: number;
  layout: "point" | "band";
  scale: Scale;
  width: number;
}) => {
  const tickLabels = scale.ticks.map((tick) => formatTick(tick));
  const longest = Math.max(1, ...tickLabels.map((label) => label.length));
  const plot: Plot = {
    bottom: height - (axes ? 22 : 1),
    left: axes ? Math.ceil(longest * AXIS_FONT_WIDTH) + 10 : 0,
    right: width - (axes && layout === "point" ? 6 : 0),
    top: axes ? 8 : 4,
  };
  const plotWidth = Math.max(1, plot.right - plot.left);
  const slots = layout === "band" ? count : count - 1;
  const band = plotWidth / Math.max(1, slots);
  const xAt = (index: number) =>
    layout === "band"
      ? plot.left + band * (index + 0.5)
      : plot.left + (count === 1 ? plotWidth / 2 : band * index);
  const span = scale.max - scale.min || 1;
  const yAt = (value: number) =>
    plot.bottom - ((value - scale.min) / span) * (plot.bottom - plot.top);
  return { band, plot, plotWidth, tickLabels, xAt, yAt };
};

/** Every `every`th label, plus the last; the one before the last drops when crowded. */
export const xLabelIndices = (count: number, every: number) => {
  const step = Math.max(1, every);
  const shown = new Set<number>();
  for (let index = 0; index < count; index += step) shown.add(index);
  const last = count - 1;
  if (last > 0 && !shown.has(last)) {
    const previous = last - (last % step);
    if (previous > 0 && last - previous < step * 0.7) shown.delete(previous);
    shown.add(last);
  }
  return shown;
};

export const labelAnchor = (layout: "point" | "band", index: number, count: number) => {
  if (layout === "band" || count === 1) return "middle";
  if (index === 0) return "start";
  return index === count - 1 ? "end" : "middle";
};

/** "Revenue and Costs" / "Revenue, Costs and Refunds". */
export const listLabels = (labels: readonly string[]) =>
  labels.length < 2
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1) ?? ""}`;

/** "Area chart of Revenue and Costs, Jan to Dec." */
export const chartSummary = <T>({
  kind,
  series,
  data,
  x,
}: {
  kind: string;
  series: readonly { label: string }[];
  data: readonly T[];
  x: Accessor<T, string | number>;
}) => {
  const [first] = data;
  const last = data.at(-1);
  const range =
    first === undefined || last === undefined
      ? ""
      : `, ${readLabel(first, x)} to ${readLabel(last, x)}`;
  return `${kind} of ${listLabels(series.map((entry) => entry.label))}${range}.`;
};
