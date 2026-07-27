#!/usr/bin/env node
/**
 * API image generation fallback: renders a mock or world board with the
 * user's own OpenAI key when the harness has no native image generation.
 *
 * context.mjs reports availability (it checks OPENAI_API_KEY); harness-native
 * generation always wins when present. This uses gpt-image-2 and spends the
 * user's API credit (roughly $0.05-0.25 per image at default quality), so the
 * skill states that before the first call in a session.
 *
 *   node generate-image.mjs --prompt "..." --out mock.png [--size 1536x1024] [--quality medium]
 *   node generate-image.mjs --prompt-file prompt.txt --out mock.png
 */
import fs from 'node:fs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
}

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error('generate-image: OPENAI_API_KEY is not set; use the harness-native image tool instead.');
  process.exit(1);
}
const promptFile = arg('prompt-file');
const prompt = promptFile ? fs.readFileSync(promptFile, 'utf8') : arg('prompt');
const out = arg('out');
if (!prompt || !out) {
  console.error('generate-image: --prompt (or --prompt-file) and --out are required.');
  process.exit(1);
}
const size = arg('size', '1536x1024');
const quality = arg('quality', 'medium');

const response = await fetch('https://api.openai.com/v1/images/generations', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-image-2', prompt, size, quality, n: 1 }),
});
if (!response.ok) {
  console.error(`generate-image: API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  process.exit(1);
}
const json = await response.json();
const b64 = json?.data?.[0]?.b64_json;
if (!b64) {
  console.error('generate-image: no image in response');
  process.exit(1);
}
fs.writeFileSync(out, Buffer.from(b64, 'base64'));
console.log(`IMAGE: ${out} (${size}, ${quality}, gpt-image-2, billed to your OpenAI key)`);
