import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PreviewPlayer from './preview-player.svelte';
import { createBlankProject } from '../project/defaults';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { timelinePreviewScrub } from '../preview/timeline-preview-scrub';
import { updateTextSpan } from '../timeline/actions/text-layout';
import '../../../routes/layout.css';

const nextPaint = () =>
	new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	);

it('removes the old hover text when returning to the paused, edited frame', async () => {
	const project = createBlankProject('Hover text');
	project.timeline!.items = [
		{
			id: 'title',
			type: 'text',
			label: 'Title',
			text: 'Title\nOLD',
			textSpans: [
				{ text: 'Title', fontSize: 70 },
				{ text: 'OLD', fontSize: 50 }
			],
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 300,
			fontFamily: 'Arial',
			fontSize: 70,
			color: '#fff',
			transform: { width: 640, height: 360 }
		}
	];
	editorSession.project = project;
	sequenceStore.load(project.timeline!, project.metadata);
	const screen = await render(PreviewPlayer, { onedit: () => {} });
	try {
		timelinePreviewScrub.setFrame(20);
		await nextPaint();
		timelinePreviewScrub.clear();
		await nextPaint();
		updateTextSpan('title', 1, { text: 'NEW WORDS' });
		await nextPaint();
		const overlay = screen.container.querySelector<HTMLCanvasElement>('[data-text-scrub-overlay]');
		// No old hover raster may cover the current authored preview after pointer leave.
		expect(overlay === null || !overlay.checkVisibility()).toBe(true);
		const raster = screen.container.querySelector<HTMLCanvasElement>('canvas');
		expect(raster).not.toBeNull();
	} finally {
		await screen.unmount();
		timelinePreviewScrub.clear();
		timelineStore.__resetForTesting();
		editorSession.project = null;
	}
});
