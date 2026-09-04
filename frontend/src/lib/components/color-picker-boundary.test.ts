import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const sharedColorPicker = new URL('./color-picker.svelte', import.meta.url);
const videoEditorRoute = new URL('../../routes/video-editor/[id]/+page.svelte', import.meta.url);

async function svelteFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = `${directory}/${entry.name}`;
			if (entry.isDirectory()) return svelteFiles(path);
			return entry.isFile() && entry.name.endsWith('.svelte') ? [path] : [];
		})
	);
	return nested.flat();
}

describe('shared color picker boundary', () => {
	it('does not leave user-facing color choices to the browser picker', async () => {
		const files = await svelteFiles(sourceRoot);
		const offenders: string[] = [];

		for (const file of files) {
			const source = await readFile(file, 'utf8');
			if (/type\s*=\s*(?:["']color["']|\{[^}]*["']color["'][^}]*\})/u.test(source)) {
				offenders.push(file.replace(`${sourceRoot}/`, ''));
			}
		}

		expect(offenders).toEqual([]);
	});

	it('keeps brand and recent palettes in the canonical picker', async () => {
		const source = await readFile(sharedColorPicker, 'utf8');

		expect(source).toContain('brandColors');
		expect(source).toContain('recentColors');
		expect(source).toContain('m.image_editor_brand_colors()');
		expect(source).toContain('m.image_editor_recent_colors()');
	});

	it('provides workspace brand colors to every picker in the video editor', async () => {
		const source = await readFile(videoEditorRoute, 'utf8');

		expect(source).toContain('provideColorPickerPalette');
		expect(source).toContain('queryImageEditorBrandKit(workspaceId)');
		expect(source).toContain('colorPickerBrandColors = kit.colors');
	});
});
