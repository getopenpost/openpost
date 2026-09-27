import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import { editorSession } from '../editor.svelte';
import { createBlankProject } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { colorPreviewStore } from '../effects/color-preview-store.svelte';
import PreviewPlayer from './preview-player.svelte';
import '../../../routes/layout.css';

afterEach(() => {
	colorPreviewStore.__resetForTesting();
	editorSession.project = null;
});

it('previews the rendered color on hover and selects that same color on click', async () => {
	const project = createBlankProject('Picker');
	project.timeline!.items = [
		{
			id: 'red',
			type: 'shape',
			shapeType: 'rectangle',
			fillColor: '#ff0000',
			label: 'Red',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 60,
			transform: { x: 0, y: 0, width: 1920, height: 1080 }
		}
	];
	editorSession.project = project;
	sequenceStore.load(project.timeline!, project.metadata);
	const screen = await render(PreviewPlayer, { onedit: vi.fn(), selectedItemId: 'red' });
	screen.container.style.cssText = 'width: 800px; height: 450px; display: flex';
	colorPreviewStore.setScopeSampleItemId('red');
	const result = vi.fn();
	const picked = colorPreviewStore.requestPick('red', 'white-balance').then(result);
	const picker = screen.getByRole('button', { name: /Choose a color in the preview/ });
	await expect.element(picker).toBeVisible();
	await expect
		.poll(async () => {
			await userEvent.hover(picker);
			return screen.container.querySelector('[data-testid="video-editor-eyedropper-magnifier"]')
				?.textContent;
		})
		.toContain('#FF0000');
	expect(result).not.toHaveBeenCalled();
	await picker.click();
	await picked;
	expect(result).toHaveBeenCalledWith({ r: 1, g: 0, b: 0 });
	await expect
		.element(screen.getByTestId('video-editor-eyedropper-magnifier'))
		.not.toBeInTheDocument();
});
