import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { editorSession } from '$lib/video-editor/editor.svelte';
import { createBlankProject } from '$lib/video-editor/project/defaults';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
import {
	createCompositeComposition,
	switchSequence
} from '$lib/video-editor/sequences/sequence-actions';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import ProjectCanvasPanel from './project-canvas-panel.svelte';
import '../../../routes/layout.css';

beforeEach(() => {
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	const project = createBlankProject('Canvas');
	editorSession.project = project;
	sequenceStore.load(project.timeline!, project.metadata);
});

afterEach(async () => {
	await page.viewport(1280, 900);
	editorSession.project = null;
	sequenceStore.reset();
});

describe('ProjectCanvasPanel', () => {
	it('edits canvas settings as separate undoable changes at phone width', async () => {
		await page.viewport(320, 720);
		const onedit = vi.fn();
		const screen = await render(ProjectCanvasPanel, { onedit });
		screen.container.style.width = '320px';
		screen.container.style.padding = '16px';
		screen.container.style.background = 'oklch(0.145 0.008 55)';
		screen.container.style.color = 'oklch(0.94 0.01 55)';

		const width = screen.getByRole('spinbutton', { name: 'Width' });
		await width.fill('1080');
		width.element().dispatchEvent(new Event('change', { bubbles: true }));
		const height = screen.getByRole('spinbutton', { name: 'Height' });
		await height.fill('1920');
		height.element().dispatchEvent(new Event('change', { bubbles: true }));
		expect(editorSession.project?.metadata).toMatchObject({ width: 1080, height: 1920 });

		await screen.getByRole('button', { name: 'Swap' }).click();
		expect(editorSession.project?.metadata).toMatchObject({ width: 1920, height: 1080 });
		const background = screen.getByRole('textbox', { name: 'Background hex value' });
		await background.fill('#123456');
		background.element().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(editorSession.project?.metadata.backgroundColor).toBe('#123456');
		expect(commandHistory.undoStack).toHaveLength(4);
		expect(onedit).toHaveBeenCalledTimes(4);

		commandHistory.undo();
		expect(editorSession.project?.metadata.backgroundColor).toBe('#000000');
		commandHistory.undo();
		expect(editorSession.project?.metadata).toMatchObject({ width: 1080, height: 1920 });
		await expect.element(background).toHaveValue('#000000');
		await expect.element(width).toHaveValue(1080);
		await expect.element(height).toHaveValue(1920);

		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-project-canvas-phone.png'
		});
	});

	it('restores invalid input without adding history', async () => {
		const onedit = vi.fn();
		const screen = await render(ProjectCanvasPanel, { onedit });
		const width = screen.getByRole('spinbutton', { name: 'Width' });
		await width.fill('319');
		width.element().dispatchEvent(new Event('change', { bubbles: true }));

		expect(width.element()).toHaveValue(1920);
		expect(commandHistory.undoStack).toHaveLength(0);
		expect(onedit).not.toHaveBeenCalled();
	});

	it('edits the active Motion canvas without changing the project canvas', async () => {
		const compositionId = createCompositeComposition({
			name: 'Square card',
			width: 1080,
			height: 1080,
			fps: 30,
			durationInFrames: 300
		});
		switchSequence(compositionId);
		commandHistory.clearHistory();
		const onedit = vi.fn();
		const screen = await render(ProjectCanvasPanel, { onedit });

		await expect.element(screen.getByRole('heading', { name: 'Composition canvas' })).toBeVisible();
		const width = screen.getByRole('spinbutton', { name: 'Width' });
		await width.fill('720');
		width.element().dispatchEvent(new Event('change', { bubbles: true }));
		const background = screen.getByRole('textbox', { name: 'Background hex value' });
		await background.fill('#123456');
		background.element().dispatchEvent(new FocusEvent('blur', { bubbles: true }));

		expect(sequenceStore.compositionById.get(compositionId)).toMatchObject({
			width: 720,
			backgroundColor: '#123456'
		});
		expect(editorSession.project?.metadata).toMatchObject({
			width: 1920,
			backgroundColor: '#000000'
		});
		expect(onedit).toHaveBeenCalledTimes(2);
	});
});
