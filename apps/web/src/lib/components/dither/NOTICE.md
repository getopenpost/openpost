# Dither Kit source

The ordered dithering and alpha falloff in `paint.ts` are adapted from
[`pixel.ts`, `dither-paint.ts`, and `gradient.tsx`](https://github.com/Boring-Software-Inc/dither-kit/tree/1e7faee9aa252e499651e6736ed65f7a07d9a6bd/registry/dither-kit).
The button treatment also follows `button.tsx` at that revision.

Dither Kit's root `package.json` declares MIT. That revision has no separate
license file or copyright notice. Attribution: Boring Software Inc., Dither Kit.

OpenPost renders the shared 4 by 4 Bayer thresholds and two opacity tiers as a
repeating SVG mask. Svelte and the existing semantic component recipes own the
controls, chart data, focus, and interaction. No React, Motion, chart engine,
remote assets, or continuous rendering loop is required.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
