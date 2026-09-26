import { afterEach, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import SceneBrowserPanel from './scene-browser-panel.svelte';
import { sceneBrowser } from '$lib/video-editor/media/scene-search/scene-browser.svelte';

afterEach(() => {
	sceneBrowser.reset();
	sceneBrowser.query = '';
});

it('exposes the scene library colors as a named group', async () => {
	sceneBrowser.__setAnalysisForTesting({
		schemaVersion: 1,
		detectorVersion: 1,
		mediaId: 'media-1',
		sourceFileSize: 1,
		method: 'histogram',
		sampleIntervalSec: 1,
		analyzedAt: Date.now(),
		scenes: [
			{
				id: 'media-1:0',
				mediaId: 'media-1',
				index: 0,
				startSec: 0,
				endSec: 1,
				timeSec: 0,
				text: 'Test scene',
				palette: [{ l: 60, a: 10, b: 10, weight: 1 }]
			}
		]
	});
	sceneBrowser.colorMode = true;

	const screen = await render(SceneBrowserPanel);

	const group = screen.getByRole('group', { name: m.video_editor_scene_library_colors() });
	await expect.element(group).toBeVisible();
	await expect
		.element(group.getByRole('button', { name: m.video_editor_scene_palette_search() }).first())
		.toBeVisible();
});

it('exposes the scene match signals as a named group', async () => {
	sceneBrowser.__setAnalysisForTesting({
		schemaVersion: 1,
		detectorVersion: 1,
		mediaId: 'media-1',
		sourceFileSize: 1,
		method: 'histogram',
		sampleIntervalSec: 1,
		analyzedAt: Date.now(),
		scenes: [
			{
				id: 'media-1:0',
				mediaId: 'media-1',
				index: 0,
				startSec: 0,
				endSec: 1,
				timeSec: 0,
				text: 'Test scene',
				palette: [{ l: 60, a: 10, b: 10, weight: 1 }]
			}
		]
	});
	sceneBrowser.query = 'Test';

	const screen = await render(SceneBrowserPanel);

	const group = screen.getByRole('group', { name: m.video_editor_scene_match_signals() });
	await expect.element(group).toBeVisible();
	await expect.element(group.getByText(m.video_editor_scene_match_keyword())).toBeVisible();
});
