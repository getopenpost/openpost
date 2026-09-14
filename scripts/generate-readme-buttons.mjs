import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Static CTA buttons for the README. They reuse the badge dither recipe from
// scripts/generate-readme-badges.mjs: one background color with a white Bayer
// dither overlay, icon plus label in a contrasting ink. Unlike the badges they
// have no live counts, so the SVGs are checked in and only regenerated here.

export const BUTTON_NAMES = ["start-trial", "self-host", "report-bug", "join-discord"];

const BUTTON_HEIGHT = 36;
const BUTTON_RADIUS = 8;
const ICON_SIZE = 16;
const PADDING_LEFT = 14;
const PADDING_RIGHT = 16;
const ICON_GAP = 8;
const FONT_SIZE = 14;

// [background, ink] per color scheme. Green/orange/gray match the value side
// of the README badges; blurple is Discord's brand color tuned for contrast.
const COLORS = {
  "start-trial": {
    light: ["#9ed9ad", "#102117"],
    dark: ["#72d18d", "#102117"],
  },
  "self-host": {
    light: ["#d0d0d0", "#111111"],
    dark: ["#e8e8e8", "#111111"],
  },
  "report-bug": {
    light: ["#f3b77f", "#2a160b"],
    dark: ["#ffad66", "#2a160b"],
  },
  "join-discord": {
    light: ["#aeb4ff", "#1e2150"],
    dark: ["#5662eb", "#ffffff"],
  },
};

const LABELS = {
  "start-trial": "Start a 14-day trial",
  "self-host": "Get started with self-hosting",
  "report-bug": "Report a bug",
  "join-discord": "Join Discord",
};

// Measured at the rendered 14px Geist Bold size. textLength keeps the labels
// at these bounds when an SVG renderer falls back to Arial or system sans.
const LABEL_WIDTHS = {
  "start-trial": 128,
  "self-host": 200,
  "report-bug": 88,
  "join-discord": 86,
};

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function ditherThreshold(x, y) {
  return (BAYER[y % 4][x % 4] + 0.5) / 16;
}

function ditherPattern(height) {
  const cell = 2;
  const rows = height / cell;
  const rects = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const density = row / (rows - 1);
      const lit = ditherThreshold(column, row) < density;
      const alpha = (0.08 + density * 0.42) * (lit ? 1 : 0.25);
      rects.push(
        `<rect x="${column * cell}" y="${row * cell}" width="${cell}" height="${cell}" fill="#fff" fill-opacity="${alpha.toFixed(3)}"/>`,
      );
    }
  }
  return `<pattern id="dither" width="8" height="${height}" patternUnits="userSpaceOnUse">${rects.join("")}</pattern>`;
}

function escapeXML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character],
  );
}

// Icons draw in a 24x24 box, except Discord which reuses its brand mark.
const DISCORD_PATH =
  "M25.4756 7.67453C23.7413 6.88135 21.9106 6.31848 20.0303 6.00024C19.7741 6.46043 19.542 6.93365 19.335 7.418C18.3348 7.26713 17.3247 7.1912 16.3131 7.19083C15.3033 7.19083 14.2885 7.26758 13.291 7.41605C13.0873 6.93519 12.8507 6.45839 12.594 6C10.7135 6.32127 8.88271 6.88527 7.14744 7.67786C3.70111 12.7762 2.76714 17.7471 3.23412 22.6475C5.25217 24.138 7.51076 25.2716 9.9118 25.9991C10.4503 25.2723 10.9326 24.4984 11.3421 23.6931C10.5608 23.4021 9.80676 23.0422 9.08897 22.6179C9.27785 22.481 9.46258 22.3399 9.64107 22.2028C11.7282 23.1831 14.0088 23.6944 16.3162 23.6944C18.6237 23.6944 20.9042 23.1831 22.9915 22.2026C23.1721 22.35 23.3569 22.4912 23.5436 22.6178C22.8244 23.0429 22.069 23.4036 21.2863 23.6959C21.6973 24.5029 22.1758 25.2737 22.7168 26C25.12 25.2748 27.3804 24.1412 29.3989 22.6489L29.3983 22.6495C29.9463 16.9667 28.4622 12.0414 25.4756 7.67453ZM11.9327 19.6338C10.6313 19.6338 9.5562 18.4528 9.5562 16.9999C9.5562 15.547 10.5939 14.3557 11.9285 14.3557C13.2631 14.3557 14.3299 15.547 14.3071 16.9999C14.2842 18.4528 13.259 19.6338 11.9327 19.6338ZM20.6998 19.6338C19.3963 19.6338 18.3253 18.4528 18.3253 16.9999C18.3253 15.547 19.3631 14.3557 20.6998 14.3557C22.0364 14.3557 23.0949 15.547 23.0721 16.9999C23.0493 18.4528 22.026 19.6338 20.6998 19.6338Z";

function iconMarkup(kind, x, y, ink) {
  const scale = ICON_SIZE / 24;
  const open = `<g transform="translate(${x} ${y}) scale(${scale.toFixed(4)})">`;
  if (kind === "start-trial") {
    return `${open}<path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z" fill="${ink}"/><path d="M19 1.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="${ink}"/></g>`;
  }
  if (kind === "self-host") {
    return `${open}<g fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></g></g>`;
  }
  if (kind === "report-bug") {
    return `${open}<g fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round"><rect x="8" y="7" width="8" height="11" rx="4"/><path d="M9.5 7 7 4M14.5 7l2.5-3M4.5 12H8M4.5 17l3.5-1.5M19.5 12H16M19.5 17 16 15.5M12 7V4"/></g></g>`;
  }
  const discordScale = ICON_SIZE / 32;
  const discordWidth = 33 * discordScale;
  const dx = x - (discordWidth - ICON_SIZE) / 2;
  return `<g transform="translate(${dx.toFixed(2)} ${y}) scale(${discordScale.toFixed(4)})"><path d="${DISCORD_PATH}" fill="${ink}"/></g>`;
}

export function renderButton(kind, mode) {
  const palette = COLORS[kind]?.[mode];
  if (!palette) throw new Error(`Unknown button: ${kind} (${mode})`);
  const [background, ink] = palette;
  const label = LABELS[kind];
  if (!label) throw new Error(`Unknown button: ${kind}`);
  const labelWidth = LABEL_WIDTHS[kind];
  if (!labelWidth) throw new Error(`Missing label width: ${kind}`);
  const width = PADDING_LEFT + ICON_SIZE + ICON_GAP + labelWidth + PADDING_RIGHT;
  const iconY = (BUTTON_HEIGHT - ICON_SIZE) / 2;
  const textX = PADDING_LEFT + ICON_SIZE + ICON_GAP;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BUTTON_HEIGHT}" viewBox="0 0 ${width} ${BUTTON_HEIGHT}" role="img" aria-label="${escapeXML(label)}" shape-rendering="crispEdges"><defs><clipPath id="button-clip"><rect width="${width}" height="${BUTTON_HEIGHT}" rx="${BUTTON_RADIUS}"/></clipPath>${ditherPattern(BUTTON_HEIGHT)}</defs><g clip-path="url(#button-clip)"><rect width="${width}" height="${BUTTON_HEIGHT}" fill="${background}"/><rect width="${width}" height="${BUTTON_HEIGHT}" fill="url(#dither)"/></g><rect x='0.5' y='0.5' width='${width - 1}' height='${BUTTON_HEIGHT - 1}' rx='${BUTTON_RADIUS - 0.5}' fill='none' stroke='#000' stroke-opacity='0.12'/>${iconMarkup(kind, PADDING_LEFT, iconY, ink)}<text x="${textX}" y="${BUTTON_HEIGHT / 2 + 0.5}" textLength="${labelWidth}" lengthAdjust="spacingAndGlyphs" fill="${ink}" font-family="Geist,Arial,sans-serif" font-size="${FONT_SIZE}" font-weight="700" dominant-baseline="middle">${escapeXML(label)}</text></svg>`;
}

export async function writeButtons(outputDir) {
  const destination = resolve(outputDir);
  const files = [];
  for (const kind of BUTTON_NAMES) {
    for (const mode of ["light", "dark"]) {
      files.push({
        path: `${destination}/${kind}-${mode}.svg`,
        content: renderButton(kind, mode),
      });
    }
  }
  await mkdir(destination, { recursive: true });
  await Promise.all(files.map(({ path, content }) => writeFile(path, `${content}\n`, "utf8")));
  return files.map(({ path }) => path);
}

if (import.meta.main) {
  try {
    const outputDir = process.argv[2] ?? "assets/buttons";
    const paths = await writeButtons(outputDir);
    console.log(`Wrote ${paths.length} README buttons to ${outputDir}/.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
