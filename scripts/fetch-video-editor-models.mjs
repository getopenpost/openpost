import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.cwd(), "frontend/static/video-editor-models");
const whisperRevision = "ff4177021cc41f7db950912b73ea4fdf7d01d8e7";
const whisperDirectory = `whisper-tiny-multilingual-${whisperRevision}`;
const whisperFiles = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "added_tokens.json",
  "merges.txt",
  "normalizer.json",
  "vocab.json",
  "onnx/encoder_model_q4.onnx",
  "onnx/decoder_model_merged_q4.onnx",
];
const sources = [
  ...whisperFiles.map((name) => ({
    name: `${whisperDirectory}/${name}`,
    url: `https://huggingface.co/onnx-community/whisper-tiny/resolve/${whisperRevision}/${name}`,
  })),
  {
    name: "silero-vad-v6.2.onnx",
    url: "https://raw.githubusercontent.com/snakers4/silero-vad/v6.2/src/silero_vad/data/silero_vad.onnx",
  },
];

await mkdir(root, { recursive: true });
const files = [];
for (const source of sources) {
  const target = path.join(root, source.name);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await readFile(target);
  } catch {
    const response = await fetch(source.url, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(
        `Model download failed (${response.status}): ${source.url}`,
      );
    }
    const temporary = `${target}.partial`;
    await rm(temporary, { force: true });
    await finished(
      Readable.fromWeb(response.body).pipe(createWriteStream(temporary)),
    );
    await rename(temporary, target);
  }
  const bytes = await readFile(target);
  files.push({
    path: source.name,
    size_bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    source_url: source.url,
  });
}

const whisperEntries = files.filter((file) =>
  file.path.startsWith(`${whisperDirectory}/`),
);
const whisperFingerprint = createHash("sha256")
  .update(
    whisperEntries.map((file) => `${file.path}:${file.sha256}`).join("\n"),
  )
  .digest("hex");
const vad = files.find(
  (file) => file.path.endsWith(".onnx") && !file.path.includes("/"),
);
const manifest = {
  version: 1,
  generated_from_pinned_sources: true,
  models: [
    {
      id: "whisper-tiny-multilingual",
      kind: "transcription",
      version: whisperRevision,
      base_path: whisperDirectory,
      size_bytes: whisperEntries.reduce(
        (total, file) => total + file.size_bytes,
        0,
      ),
      sha256: whisperFingerprint,
      runtime_bytes_wasm: 11133407,
      runtime_bytes_webgpu: 21596019,
      required_backends: ["webgpu", "wasm"],
      fingerprint: `whisper-tiny-multilingual:${whisperRevision}:q4`,
      resumable: true,
      license_reference: "THIRD_PARTY_LICENSES.md",
      license_name: "Apache-2.0",
      license_url: "https://www.apache.org/licenses/LICENSE-2.0",
      files: whisperEntries,
    },
    {
      id: "silero-vad",
      kind: "vad",
      version: "6.2",
      path: vad.path,
      size_bytes: vad.size_bytes,
      sha256: vad.sha256,
      runtime_bytes_wasm: 12666427,
      runtime_bytes_webgpu: 0,
      required_backends: ["wasm"],
      fingerprint: "silero-vad:6.2:onnx",
      resumable: true,
      license_reference: "THIRD_PARTY_LICENSES.md",
      license_name: "MIT",
      license_url: "https://github.com/snakers4/silero-vad/blob/v6.2/LICENSE",
      files: [vad],
    },
  ],
};
await writeFile(
  path.join(root, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await writeFile(
  path.join(root, "README.md"),
  `# OpenPost Video Editor local models

These model files are fetched from immutable upstream revisions by
\`scripts/fetch-video-editor-models.mjs\`. The editor does not download them until a user
starts transcription or voice analysis. \`manifest.json\` records every source URL,
byte size, and SHA-256 digest.

- Whisper Tiny multilingual ONNX conversion: Apache-2.0 model repository.
- Silero VAD 6.2: MIT.

See \`THIRD_PARTY_LICENSES.md\` before redistributing these files.
`,
);
await writeFile(
  path.join(root, "THIRD_PARTY_LICENSES.md"),
  `# Third-party model notices

## Whisper Tiny multilingual

The ONNX model and tokenizer files come from
[onnx-community/whisper-tiny](https://huggingface.co/onnx-community/whisper-tiny/tree/${whisperRevision})
at commit \`${whisperRevision}\`. The model repository declares the Apache License 2.0.

## Silero VAD

\`silero-vad-v6.2.onnx\` comes from
[snakers4/silero-vad](https://github.com/snakers4/silero-vad/tree/v6.2) and is
distributed under the MIT License.
`,
);

console.log(
  `OpenPost Video Editor models ready: ${manifest.models
    .map(
      (model) =>
        `${model.id} ${(model.size_bytes / 1024 / 1024).toFixed(1)} MiB`,
    )
    .join(", ")}`,
);
