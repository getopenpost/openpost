import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const sourceDirectory = "tmp/product-demos";
const outputDirectory = "assets/demos";
const maxBytes = 2_000_000;
const demos = [
  { name: "publishing", fps: 8, colors: 128 },
  { name: "image-editor", fps: 6, colors: 96 },
  { name: "video-editor", fps: 8, colors: 112 },
];

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}

await mkdir(outputDirectory, { recursive: true });
for (const { name, fps, colors } of demos) {
  const source = join(sourceDirectory, `${name}.ffconcat`);
  const gif = join(sourceDirectory, `${name}.gif`);
  const optimized = join(sourceDirectory, `${name}-optimized.gif`);
  const scenes = JSON.parse(await readFile(join(sourceDirectory, `${name}-scenes.json`), "utf8"));
  let start = 0;
  const captions = await Promise.all(
    scenes.map(async (scene, index) => {
      const path = join(sourceDirectory, `${name}-caption-${index}.txt`);
      const from = start;
      start += scene.seconds;
      const end = start;
      await writeFile(path, scene.title);
      return `drawtext=fontfile=assets/brand/fonts/Geist-SemiBold.ttf:textfile=${path}:expansion=none:fontcolor=white:fontsize=48:x=(w-tw)/2:y=h-76:enable='gte(t,${from})*lt(t,${end})'`;
    }),
  );
  const captionFilter = `pad=iw:ih+104:color=0x171512,${captions.join(",")}`;
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    source,
    "-vf",
    `fps=12,${captionFilter},scale=960:-2:flags=lanczos`,
    "-c:v",
    "libx264",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    join(sourceDirectory, `${name}.mp4`),
  ]);
  const palette = join(sourceDirectory, `${name}-palette.png`);
  const gifFilter = `fps=${fps},${captionFilter},scale=800:-2:flags=lanczos`;
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    source,
    "-vf",
    `${gifFilter},palettegen=max_colors=${colors}`,
    "-frames:v",
    "1",
    "-update",
    "1",
    palette,
  ]);
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    source,
    "-i",
    palette,
    "-filter_complex",
    `[0:v]${gifFilter}[frames];[frames][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    "-loop",
    "0",
    gif,
  ]);
  run("gifsicle", ["-O3", gif, "-o", optimized]);
  const { size } = await stat(optimized);
  if (size > maxBytes)
    throw new Error(
      `${name}.gif is ${(size / 1e6).toFixed(2)} MB, over the 2 MB README budget. Shorten the capture or tune the encoding and inspect it again.`,
    );
  await copyFile(optimized, join(outputDirectory, `${name}.gif`));
  console.log(`${name}.gif: ${(size / 1e6).toFixed(2)} MB`);
}
