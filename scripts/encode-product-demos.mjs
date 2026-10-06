import { spawnSync } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

const sourceDirectory = "tmp/product-demos";
const outputDirectory = "assets/demos";
const maxBytes = 2_000_000;
const demos = ["publishing", "image-editor", "video-editor"];

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}

await mkdir(outputDirectory, { recursive: true });
for (const name of demos) {
  const source = join(sourceDirectory, `${name}.webm`);
  const gif = join(sourceDirectory, `${name}.gif`);
  const optimized = join(sourceDirectory, `${name}-optimized.gif`);
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    source,
    "-vf",
    "scale=960:-2:flags=lanczos",
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
    join(sourceDirectory, `${name}.ffconcat`),
    "-filter_complex",
    "fps=8,scale=800:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
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
