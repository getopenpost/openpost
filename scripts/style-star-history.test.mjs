import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import sharp from "sharp";
import { styleStarHistory } from "./style-star-history.mjs";

const source = `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="120" style="background:#fff">
<filter id="sketch"><feTurbulence baseFrequency=".05"/></filter>
<g pointer-events="all" transform="translate(20 20)">
<g class="xaxis"><path class="domain" d="M.5.5h100" transform="translate(0 80)"/></g>
<path class="xkcd-chart-xyline" d="M0 80L50 40L100 0" fill="none" stroke="#dd4528" filter="url(#sketch)"/>
<svg><svg><rect width="8" height="8"/><text>getopenpost/openpost</text></svg></svg>
</g><text x="20" y="115">Jan</text>
<text x="50%" y="30">Star History</text>
<svg><defs><clipPath id="clip-circle-title"><circle cx="70" cy="10" r="5"/></clipPath></defs></svg>
<image width="10" height="10" x="65" y="5" clip-path="url(#clip-circle-title)"/>
</svg>`;

for (const scheme of ["light", "dark"]) {
  test(`${scheme} chart has a transparent canvas and dithered fill beneath the original curve`, async () => {
    const result = await styleStarHistory(source, scheme);
    assert.match(result, /d="M0 80L50 40L100 0"/);
    assert.match(result, />Jan<\/text>/);
    assert.doesNotMatch(result, /feTurbulence|filter="url/);
    assert.doesNotMatch(result, /Star History|getopenpost\/openpost|clip-circle-title/);
    const { data, info } = await sharp(Buffer.from(result))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = (x, y) => data[(y * info.width + x) * info.channels + 3];
    assert.equal(alpha(2, 2), 0, "the image background is transparent");
    assert.equal(alpha(40, 40), 0, "the fill does not cross above the measured curve");
    const middle = [];
    const bottom = [];
    for (let x = 100; x < 112; x++) {
      middle.push(alpha(x, 60));
      bottom.push(alpha(x, 96));
    }
    assert.ok(
      Math.max(...middle) - Math.min(...middle) > 45,
      "the fill contains visible pixel contrast",
    );
    assert.ok(Math.min(...bottom) > 200, "the base of the area is nearly solid");
    assert.equal(
      await styleStarHistory(result, scheme),
      result,
      "a refresh does not stack decorative layers",
    );
  });
}

test("a changed upstream chart shape fails before producing a misleading chart", async () => {
  await assert.rejects(
    styleStarHistory('<svg width="140" height="120"></svg>', "light"),
    /star-history chart/,
  );
});

test("the action renderer refreshes both themes and a transparent 2x PNG", async () => {
  const directory = await mkdtemp(join(tmpdir(), "star-history-render-"));
  try {
    for (const scheme of ["light", "dark"]) {
      await writeFile(join(directory, `star-history-${scheme}.svg`), source);
    }
    execFileSync("bun", [
      fileURLToPath(new URL("./style-star-history.mjs", import.meta.url)),
      directory,
    ]);
    for (const scheme of ["light", "dark"]) {
      const svg = await readFile(join(directory, `star-history-${scheme}.svg`), "utf8");
      assert.match(svg, /d="M0 80L50 40L100 0"/);
      assert.doesNotMatch(svg, /feTurbulence/);
    }
    const { data, info } = await sharp(join(directory, "star-history.png"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 280);
    assert.equal(info.height, 240);
    assert.equal(data[3], 0, "PNG downloads also have no opaque canvas");
    assert.ok(
      data[(192 * info.width + 204) * info.channels + 3] > 200,
      "PNG downloads include the filled area",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
