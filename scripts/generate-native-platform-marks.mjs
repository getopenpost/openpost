import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const platforms = [
  "x",
  "threads",
  "bluesky",
  "mastodon",
  "pixelfed",
  "peertube",
  "lemmy",
  "piefed",
  "linkedin",
  "facebook",
  "instagram",
  "youtube",
  "tiktok",
  "pinterest",
  "telegram",
  "discord",
];
const marks = Object.fromEntries(
  await Promise.all(
    platforms.map(async (platform) => [
      platform,
      (await readFile(new URL(`assets/logos/${platform}.svg`, root), "utf8"))
        .replace(/<title>.*?<\/title>/gs, "")
        .trim(),
    ]),
  ),
);
const source = `${JSON.stringify(marks, null, 2)}\n`;
const target = new URL("apps/mobile/src/lib/platform-marks.json", root);
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8").catch(() => "")) !== source)
    throw new Error(
      `Regenerate ${fileURLToPath(target)} with bun scripts/generate-native-platform-marks.mjs`,
    );
} else {
  await writeFile(target, source);
}
