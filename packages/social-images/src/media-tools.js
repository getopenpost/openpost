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
      "Turn a clipboard image into a file. Paste, choose a format, and download at full resolution. Free, with no account or upload.",
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
];
