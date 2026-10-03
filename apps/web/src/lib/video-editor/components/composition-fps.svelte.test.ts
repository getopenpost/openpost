import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { createBlankProject, createDefaultTracks } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { nestSequence } from '../sequences/sequence-actions';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { TimelineFrameRenderer } from '../media/render-export';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import { createProject, getProject } from '../workspace-fs/projects';
import { WebThemeRuntime } from '$lib/themes/runtime';
import { resolveBuiltInTheme } from '$lib/themes/builtins';
import '../../../routes/layout.css';
import CompositionTimeline from './composition-timeline.svelte';

it('explains source FPS edits and preserves existing and fresh instance clocks through history and reload', async () => {
	const project = createBlankProject('FPS diagnostic');
	project.metadata = { ...project.metadata, width: 64, height: 64, fps: 30 };
	const tracks = createDefaultTracks();
	project.timeline = {
		...project.timeline!,
		tracks,
		items: [],
		compositions: [
			{
				id: 'phases',
				name: 'Red then blue',
				editorKind: 'composite-2d',
				fps: 30,
				width: 64,
				height: 64,
				durationInFrames: 90,
				tracks,
				transitions: [],
				items: ['#ff0000', '#0000ff'].map((fillColor, index) => ({
					id: `phase-${index}`,
					type: 'shape' as const,
					label: fillColor,
					shapeType: 'rectangle' as const,
					fillColor,
					trackId: tracks[0]!.id,
					from: index * 45,
					durationInFrames: 45,
					transform: { x: 0, y: 0, width: 64, height: 64 }
				}))
			}
		]
	};
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	sequenceStore.load(project.timeline, project.metadata);
	commandHistory.clearHistory();
	const oldId = nestSequence('phases', 0)[0]!;
	sequenceStore.switchTo('phases');
	const screen = await render(CompositionTimeline, { onedit: vi.fn() });
	const theme = new WebThemeRuntime();
	try {
		const fps = screen.getByTestId('composition-fps');
		await expect
			.element(fps)
			.toHaveAccessibleDescription(
				'Changing FPS keeps frame counts and changes duration in seconds. Existing composition clips keep their inserted frame rate; new clips use this FPS.'
			);
		await fps.fill('60');
		await userEvent.keyboard('{Tab}');
		expect(sequenceStore.compositionById.get('phases')?.fps).toBe(60);
		expect(sequenceStore.compositionById.get('phases')?.durationInFrames).toBe(90);
		commandHistory.undo();
		expect(sequenceStore.compositionById.get('phases')?.fps).toBe(30);
		commandHistory.redo();
		expect(sequenceStore.compositionById.get('phases')?.fps).toBe(60);
		for (const scheme of ['light', 'dark'] as const) {
			await theme.apply(resolveBuiltInTheme('dither', scheme), document.documentElement);
			for (const width of [1280, 390, 320]) {
				await page.viewport(width, 844);
				fps.element().focus();
				await expect.element(fps).toHaveFocus();
				await expect
					.element(
						screen.getByText(
							'Changing FPS keeps frame counts and changes duration in seconds. Existing composition clips keep their inserted frame rate; new clips use this FPS.',
							{ exact: true }
						)
					)
					.toBeVisible();
				await page.screenshot({ path: `mt002-${scheme}-${width}.png` });
			}
		}
		sequenceStore.switchTo(null);
		const freshId = nestSequence('phases', 120)[0]!;
		expect(timelineStore.itemById.get(oldId)).toMatchObject({
			sourceFps: 30,
			durationInFrames: 90
		});
		expect(timelineStore.itemById.get(freshId)).toMatchObject({
			sourceFps: 60,
			durationInFrames: 45
		});
		const previousRoot = getWorkspaceRoot();
		const opfs = await navigator.storage.getDirectory();
		const directory = `composition-fps-${crypto.randomUUID()}`;
		try {
			setWorkspaceRoot(await opfs.getDirectoryHandle(directory, { create: true }));
			await createProject({ ...project, timeline: sequenceStore.projectTimeline() });
			const loaded = (await getProject(project.id))!;
			sequenceStore.reset();
			sequenceStore.load(loaded.timeline!, loaded.metadata);
		} finally {
			setWorkspaceRoot(previousRoot);
			await opfs.removeEntry(directory, { recursive: true });
		}
		expect(timelineStore.itemById.get(oldId)).toMatchObject({
			sourceFps: 30,
			durationInFrames: 90
		});
		expect(timelineStore.itemById.get(freshId)).toMatchObject({
			sourceFps: 60,
			durationInFrames: 45
		});
		expect(sequenceStore.compositionById.get('phases')?.fps).toBe(60);
		const renderer = new TimelineFrameRenderer({
			...project,
			timeline: sequenceStore.projectTimeline()
		});
		try {
			const old = await renderer.render(30);
			const oldPixel = Array.from(old.getContext('2d')!.getImageData(32, 32, 1, 1).data);
			const fresh = await renderer.render(150);
			const freshPixel = Array.from(fresh.getContext('2d')!.getImageData(32, 32, 1, 1).data);
			expect(oldPixel[0]).toBeGreaterThanOrEqual(254);
			expect(oldPixel[2]).toBeLessThanOrEqual(1);
			expect(freshPixel[0]).toBeLessThanOrEqual(1);
			expect(freshPixel[2]).toBeGreaterThanOrEqual(254);
			console.info(
				'MT002 independent one-second samples',
				JSON.stringify({
					oldPixel,
					freshPixel,
					oldSourceFps: 30,
					freshSourceFps: 60,
					sourceFps: 60
				})
			);
		} finally {
			renderer.dispose();
		}
	} finally {
		await screen.unmount();
		theme.clear(document.documentElement);
		sequenceStore.reset();
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	}
});
