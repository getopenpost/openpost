import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ditherThreshold } from "../apps/web/src/lib/components/dither/paint.ts";

const cellSize = 2;
const themes = {
  light: { ink: "#302b28", rgb: [183, 76, 5] },
  dark: { ink: "#e6e0dc", rgb: [255, 153, 95] },
};

// Follow Dither Kit's per-column alpha falloff, using the app's Bayer thresholds.
// Attribution and license: apps/web/src/lib/components/dither/NOTICE.md.
async function areaTexture(curve, width, floor, rgb) {
  const columns = Math.ceil(width / cellSize);
  const rows = Math.ceil(floor / cellSize);
  const area = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${floor}"><path fill="white" d="${curve} L${width} ${floor}H0Z"/></svg>`;
  const mask = await sharp(Buffer.from(area)).resize(columns, rows).ensureAlpha().raw().toBuffer();
  const pixels = Buffer.alloc(columns * rows * 4);
  for (let x = 0; x < columns; x++) {
    let top = 0;
    while (top < rows && mask[(top * columns + x) * 4 + 3] < 128) top++;
    for (let y = top; y < rows; y++) {
      const density = (y - top) / Math.max(1, rows - top - 1);
      const alpha = (0.3 + density * 0.7) * (density > ditherThreshold(x, y) ? 1 : 0.4);
      const offset = (y * columns + x) * 4;
      pixels.set(rgb, offset);
      pixels[offset + 3] = Math.round(255 * alpha);
    }
  }
  return sharp(pixels, { raw: { width: columns, height: rows, channels: 4 } })
    .resize(columns * cellSize * 2, rows * cellSize * 2, { kernel: "nearest" })
    .png()
    .toBuffer();
}

export async function styleStarHistory(source, scheme) {
  const theme = themes[scheme];
  if (!theme) throw new Error(`Unknown star-history scheme: ${scheme}`);
  const lineColor = `rgb(${theme.rgb.join(",")})`;
  let curve;
  let width;
  let floor;
  let series = 0;
  await new HTMLRewriter()
    .on("g.xaxis path.domain", {
      element(element) {
        width = Number(element.getAttribute("d")?.match(/h([\d.]+)$/)?.[1]);
        floor = Number(element.getAttribute("transform")?.match(/translate\(0 ([\d.]+)\)/)?.[1]);
      },
    })
    .on("path.xkcd-chart-xyline", {
      element(element) {
        curve = element.getAttribute("d");
        series++;
      },
    })
    .transform(new Response(source))
    .text();
  if (series !== 1 || !curve || !(width > 0) || !(floor > 0)) {
    throw new Error("Unsupported star-history chart geometry; check the pinned renderer output");
  }

  const texture = await areaTexture(curve, width, floor, theme.rgb);
  const decoration = `<g data-star-history-decoration=""><defs><clipPath id="star-history-area"><path d="${curve} L${width} ${floor}H0Z"/></clipPath></defs><image width="${width}" height="${floor}" preserveAspectRatio="none" style="image-rendering:pixelated" clip-path="url(#star-history-area)" href="data:image/png;base64,${texture.toString("base64")}"/></g>`;
  let root = true;
  return new HTMLRewriter()
    .on("svg", {
      element(element) {
        if (!root) return;
        root = false;
        element.setAttribute(
          "viewBox",
          `0 0 ${element.getAttribute("width")} ${element.getAttribute("height")}`,
        );
        element.setAttribute(
          "style",
          `font-family:Geist,sans-serif;stroke-width:1;color:${theme.ink}`,
        );
        element.setAttribute("role", "img");
        element.setAttribute("aria-label", "OpenPost GitHub star history");
      },
    })
    .on("filter, [data-star-history-decoration]", {
      element(element) {
        element.remove();
      },
    })
    .on("[filter]", {
      element(element) {
        element.removeAttribute("filter");
      },
    })
    .on("text", {
      element(element) {
        const size = element.getAttribute("y") === "30" ? 20 : 14;
        element.setAttribute(
          "style",
          `font-family:Geist,sans-serif;font-size:${size}px;fill:${theme.ink}`,
        );
      },
    })
    .on("path.domain", {
      element(element) {
        element.setAttribute("style", `stroke:${theme.ink};stroke-opacity:.22`);
      },
    })
    .on("rect", {
      element(element) {
        const fill = element.getAttribute("width") === "8" ? lineColor : "none";
        element.setAttribute("style", `fill:${fill};stroke:none`);
      },
    })
    .on("path.xkcd-chart-xyline", {
      element(element) {
        element.before(decoration, { html: true });
        element.setAttribute("stroke", lineColor);
        element.setAttribute("stroke-width", "2");
        element.setAttribute("stroke-opacity", ".8");
      },
    })
    .transform(new Response(source))
    .text();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(process.argv[2] ?? "assets/star-history");
  const variants = await Promise.all(
    Object.keys(themes).map(async (scheme) => ({
      file: path.join(directory, `star-history-${scheme}.svg`),
      svg: await styleStarHistory(
        await readFile(path.join(directory, `star-history-${scheme}.svg`), "utf8"),
        scheme,
      ),
    })),
  );
  const png = await sharp(Buffer.from(variants[0].svg), { density: 144 }).png().toBuffer();
  await Promise.all([
    ...variants.map(({ file, svg }) => writeFile(file, svg)),
    writeFile(path.join(directory, "star-history.png"), png),
  ]);
  console.log("Styled both star-history SVGs and the transparent 2x PNG.");
}
