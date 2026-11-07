import { readDitherCell, subscribeToTheme } from "@openpost/dither/engine";
import type { FillVariant } from "@openpost/dither/engine";
import type { Attachment } from "svelte/attachments";

/**
 * Reactive dither measurements shared by the chart components: the cell size
 * as `--dither-cell` resolves on the element (re-read on theme changes) and
 * the element's content width. Attach with `{@attach measure.attach}`.
 */
export class DitherMeasure {
  cell = $state(2);
  width = $state(0);
  height = $state(0);
  #override: () => number | undefined;

  constructor(override: () => number | undefined = () => undefined) {
    this.#override = override;
    this.cell = override() ?? 2;
  }

  attach: Attachment<HTMLElement | SVGElement> = (node) => {
    const read = () => {
      this.cell = this.#override() ?? readDitherCell(node);
    };
    read();
    const observer = new ResizeObserver(([entry]) => {
      this.width = Math.round(entry?.contentRect.width ?? 0);
      this.height = Math.round(entry?.contentRect.height ?? 0);
    });
    observer.observe(node);
    const unsubscribe = subscribeToTheme(read);
    $effect(() => {
      // A changed override re-reads without waiting for a theme change.
      this.#override();
      read();
    });
    return () => {
      observer.disconnect();
      unsubscribe();
    };
  };
}

/** A stable id prefix safe inside `url(#…)` references. */
export const svgId = (id: string) => `d${id.replace(/[^a-zA-Z0-9]/g, "")}`;

/** Round to one decimal so SVG paths stay short. */
export const round1 = (value: number) => Math.round(value * 10) / 10;

let decorationVersion = $state(0);
let watchingDecoration = false;

const readDecoration = (): FillVariant => {
  const value = document.documentElement.getAttribute("data-theme-decoration");
  return value === null || value === "dither" ? "gradient" : "solid";
};

/**
 * The fill a chart uses when the caller sets none: dithered under themes
 * whose decoration is `dither` (and outside themed apps), flat otherwise.
 * One shared observer bumps a version on theme switches; reading the
 * attribute itself never writes state, so this is safe inside `$derived`.
 */
export const themeFill = (): FillVariant => {
  if (typeof document === "undefined") return "gradient";
  if (!watchingDecoration) {
    watchingDecoration = true;
    subscribeToTheme(() => {
      decorationVersion += 1;
    });
  }
  void decorationVersion;
  return readDecoration();
};
