// This catalog owns the supported public media-tool routes and conversion pairs.
export const imageFormats = [
  { id: "png", name: "PNG", extension: "png", mime: "image/png" },
  { id: "jpeg", name: "JPEG", extension: "jpg", mime: "image/jpeg" },
  { id: "webp", name: "WebP", extension: "webp", mime: "image/webp" },
];

export const imageConversions = imageFormats.flatMap((input) =>
  imageFormats
    .filter((output) => output.id !== input.id)
    .map((output) => ({
      slug: `${input.extension}-to-${output.extension}`,
      name: `${input.name} to ${output.name}`,
      title: `Free ${input.name} to ${output.name} converter, full resolution - OpenPost`,
      description: `Convert ${input.name} images to ${output.name} at their original dimensions. Free, private, and processed in your browser. No account or watermark.`,
      category: "Convert",
      input: input.id,
      output: output.id,
    })),
);

export const videoFormats = [
  { id: "mp4", name: "MP4" },
  { id: "mkv", name: "MKV" },
  { id: "webm", name: "WebM" },
  { id: "mov", name: "MOV" },
];
export const audioFormats = [
  { id: "mp3", name: "MP3" },
  { id: "wav", name: "WAV" },
  { id: "m4a", name: "M4A" },
  { id: "ogg", name: "Ogg" },
  { id: "flac", name: "FLAC" },
];
// Curated pairs have distinct use cases. The general converters accept the other
// combinations without creating a page for every possible permutation.
const videoPairs = [
  ["mp4", "mkv"],
  ["mkv", "mp4"],
  ["mp4", "webm"],
  ["webm", "mp4"],
  ["mov", "mp4"],
];
const audioPairs = [
  ["mp3", "wav"],
  ["wav", "mp3"],
  ["m4a", "mp3"],
  ["mp3", "m4a"],
  ["flac", "mp3"],
  ["flac", "wav"],
  ["ogg", "mp3"],
];
const conversionTools = (pairs, formats, mode, category) =>
  pairs.map(([input, output]) => {
    const source = formats.find((format) => format.id === input).name;
    const destination = formats.find((format) => format.id === output).name;
    return {
      slug: `${input}-to-${output}`,
      name: `${source} to ${destination}`,
      title: `Free ${source} to ${destination} converter - OpenPost`,
      description: `Convert ${source} ${mode} to ${destination} on your device. Choose output settings and download for free, without an account or upload.`,
      category,
      mode,
      input,
      output,
    };
  });
export const mediaConversionTools = [
  {
    slug: "video-converter",
    name: "Video converter",
    title: "Free video converter, MP4, MKV, WebM and MOV - OpenPost",
    description:
      "Change a video's container or codec in your browser. Convert MP4, MKV, WebM and MOV locally, with no account or watermark.",
    category: "Video",
    mode: "video",
    output: "mp4",
  },
  ...conversionTools(videoPairs, videoFormats, "video", "Video"),
  {
    slug: "video-codec-converter",
    name: "Video codec converter",
    title: "Free video codec converter, H.264, H.265, VP9 and AV1 - OpenPost",
    description:
      "Change your video codec with the encoders available on your device. Choose a container, codec and bitrate, then download locally.",
    category: "Video",
    mode: "video",
    output: "mp4",
  },
  {
    slug: "video-compressor",
    name: "Video compressor",
    title: "Free video compressor, adjust bitrate and resolution - OpenPost",
    description:
      "Reduce video size by choosing a lower bitrate or resolution. Compress locally, compare the output size, and download without a watermark.",
    category: "Video",
    mode: "compress",
    output: "mp4",
  },
  {
    slug: "remove-audio-from-video",
    name: "Remove audio from video",
    title: "Remove audio from video for free - OpenPost",
    description:
      "Make a silent video by removing its audio track. Keep compatible video data without re-encoding and download the result locally.",
    category: "Video",
    mode: "mute",
    output: "mp4",
  },
  {
    slug: "audio-converter",
    name: "Audio converter",
    title: "Free audio converter, MP3, WAV, M4A, Ogg and FLAC - OpenPost",
    description:
      "Convert audio on your device. Choose MP3, WAV, M4A, Ogg or FLAC, adjust the audio settings, and download without an account.",
    category: "Audio",
    mode: "audio",
    output: "mp3",
  },
  ...conversionTools(audioPairs, audioFormats, "audio", "Audio"),
  {
    slug: "extract-audio-from-video",
    name: "Extract audio from video",
    title: "Extract audio from video, MP3, WAV or M4A - OpenPost",
    description:
      "Save a video's soundtrack as an audio file. Extract its primary audio track and download MP3, WAV, M4A, Ogg or FLAC locally.",
    category: "Audio",
    mode: "extract",
    output: "mp3",
  },
  {
    slug: "media-info",
    name: "Video and audio file info",
    title: "Check video and audio codecs, dimensions and duration - OpenPost",
    description:
      "Inspect a media file's container, codecs, dimensions, audio channels and duration without uploading it. Free, private, and no account required.",
    category: "Video",
    mode: "inspect",
  },
];

const thumbnailTones = ["mint", "lilac", "blue"];

export function mediaToolThumbnailTone(slug) {
  if (slug === "image-converter") return "mint";
  const index = [...imageConversions, ...mediaConversionTools].findIndex(
    (tool) => tool.slug === slug,
  );
  if (index < 0) return undefined;
  return thumbnailTones[index % thumbnailTones.length];
}

export const mediaTools = [
  {
    slug: "background-remover",
    name: "Background remover",
    title: "Free background remover, full-resolution PNG - OpenPost",
    description:
      "Remove an image background in your browser. Download or copy a full-resolution transparent PNG, free and without a watermark.",
    category: "Images",
  },
  {
    slug: "image-color-picker",
    name: "Image color picker",
    title: "Free image color picker and palette extractor - OpenPost",
    description:
      "Pick colors from an image and copy HEX, RGB, or HSL values. Extract a palette locally, without uploading your image.",
    category: "Images",
  },
  {
    slug: "paste-image",
    name: "Paste image to download",
    title: "Paste an image and download PNG, JPEG, or WebP - OpenPost",
    description:
      "Turn a clipboard image into a file. Paste and download a full-resolution PNG automatically. Free, with no account or upload.",
    category: "Images",
  },
  {
    slug: "logo-maker",
    name: "Logo maker",
    title: "Free logo maker, PNG and SVG downloads - OpenPost",
    description:
      "Choose an icon, set its colors and background, and download your logo as PNG or SVG. Free, with no account or watermark.",
    category: "Images",
  },
  {
    slug: "quick-cut",
    name: "Quick Cut",
    title: "Free video trimmer and cutter - OpenPost Quick Cut",
    description:
      "Trim and join compatible video segments locally with Quick Cut. A separate, focused tool for cuts without re-encoding.",
    category: "Video",
  },
  {
    slug: "image-converter",
    name: "Image converter",
    title: "Free image converter, PNG, JPEG and WebP - OpenPost",
    description:
      "Convert images to PNG, JPEG, or WebP in your browser. Keep the original dimensions, choose quality, and download without a watermark.",
    category: "Convert",
  },
  ...imageConversions,
  ...mediaConversionTools,
];
