import Graphemer from "graphemer";
import { CLUSTER_BREAK as Break, EXTENDED_PICTOGRAPHIC } from "graphemer/lib/boundaries";

// Graphemer 1.4.0 pins Unicode 15.0, matching the server's uniseg v0.4.7.
// Its splitter copies the cluster's history at every code point. Use only its
// property tables and stream UAX #29 boundaries to keep long clusters linear.
// The CommonJS default export is wrapped by the browser bundler.
const Properties =
  typeof Graphemer === "function"
    ? Graphemer
    : (Graphemer as unknown as { default: typeof Graphemer }).default;

function isControl(property: number): boolean {
  return property === Break.CR || property === Break.LF || property === Break.CONTROL;
}

export function* unicode15Graphemes(text: string): Generator<string> {
  let start = 0;
  let offset = 0;
  let previous = Break.OTHER;
  let regionalIndicators = 0;
  let pictographicSuffix = false;
  let pictographicZWJ = false;

  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    const property = Properties.getGraphemeBreakProperty(codePoint);
    const pictographic = Properties.getEmojiProperty(codePoint) === EXTENDED_PICTOGRAPHIC;
    let joins = false;
    if (offset > 0) {
      if (previous === Break.CR && property === Break.LF) {
        joins = true; // GB3
      } else if (isControl(previous) || isControl(property)) {
        joins = false; // GB4, GB5
      } else if (
        (previous === Break.L &&
          (property === Break.L ||
            property === Break.V ||
            property === Break.LV ||
            property === Break.LVT)) ||
        ((previous === Break.LV || previous === Break.V) &&
          (property === Break.V || property === Break.T)) ||
        ((previous === Break.LVT || previous === Break.T) && property === Break.T)
      ) {
        joins = true; // GB6, GB7, GB8
      } else if (
        property === Break.EXTEND ||
        property === Break.ZWJ ||
        property === Break.SPACINGMARK ||
        previous === Break.PREPEND
      ) {
        joins = true; // GB9, GB9a, GB9b
      } else if (pictographicZWJ && pictographic) {
        joins = true; // GB11: Extended_Pictographic Extend* ZWJ × Extended_Pictographic
      } else if (
        property === Break.REGIONAL_INDICATOR &&
        previous === Break.REGIONAL_INDICATOR &&
        regionalIndicators % 2 === 1
      ) {
        joins = true; // GB12, GB13
      }
      if (!joins) {
        yield text.slice(start, offset);
        start = offset;
      }
    }
    pictographicZWJ = property === Break.ZWJ && pictographicSuffix;
    pictographicSuffix = pictographic || (property === Break.EXTEND && pictographicSuffix);
    regionalIndicators = property === Break.REGIONAL_INDICATOR ? regionalIndicators + 1 : 0;
    previous = property;
    offset += character.length;
  }
  if (offset > start) yield text.slice(start, offset);
}
