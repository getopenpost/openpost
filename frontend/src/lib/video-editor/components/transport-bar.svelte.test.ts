import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { editorSession } from '$lib/video-editor/editor.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { shuttleScrubResume } from '$lib/video-editor/preview/shuttle-scrub-resume.svelte';
import TransportBar from './transport-bar.svelte';

describe('TransportBar playback state', () => {
	beforeEach(() => {
		editorSession.pausePlayback();
		editorSession.clock.seek(0);
		timelineStore.__resetForTesting();
	});

	afterEach(() => {
		editorSession.pausePlayback();
	});

	it('updates the visible transport when Clock events change the reactive session mirror', async () => {
		const screen = await render(TransportBar, { projectId: 'transport-test' });
		const play = screen.getByRole('button', { name: 'Play', exact: true });
		await expect.element(play).toBeVisible();

		await play.click();

		const pause = screen.getByRole('button', { name: 'Pause', exact: true });
		await expect.element(pause).toBeVisible();
		expect(editorSession.isPlaying).toBe(true);
		editorSession.shuttlePlayback(1, { start: 0, end: 1 });
		expect(editorSession.playbackRate).toBe(2);
		expect(editorSession.transportMode).toBe('shuttle');

		await pause.click();

		await expect.element(screen.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		expect(editorSession.isPlaying).toBe(false);
		expect(editorSession.playbackRate).toBe(1);
		expect(editorSession.transportMode).toBe('normal');
	});

	it('starts paused shuttle at 1x, then advances and resets direction exactly', async () => {
		const screen = await render(TransportBar, { projectId: 'shuttle-test' });

		editorSession.shuttlePlayback(1, { start: 0, end: 1 });
		await expect.element(screen.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		expect(editorSession.playbackRate).toBe(1);
		expect(editorSession.transportMode).toBe('shuttle');

		editorSession.shuttlePlayback(1, { start: 0, end: 1 });
		expect(editorSession.playbackRate).toBe(2);
		editorSession.shuttlePlayback(1, { start: 0, end: 1 });
		expect(editorSession.playbackRate).toBe(4);
		editorSession.shuttlePlayback(-1, { start: 0, end: 1 });
		expect(editorSession.playbackRate).toBe(-1);

		editorSession.pausePlayback();
		expect(editorSession.playbackRate).toBe(1);
		expect(editorSession.transportMode).toBe('normal');
	});

	it('preserves shuttle mode through a completed scrub and resets it on stop', async () => {
		await render(TransportBar, { projectId: 'shuttle-scrub-test' });
		editorSession.shuttlePlayback(-1, { start: 0, end: 30 });

		shuttleScrubResume.begin();
		expect(editorSession.isPlaying).toBe(false);
		expect(editorSession.playbackRate).toBe(-1);
		expect(editorSession.transportMode).toBe('shuttle');

		shuttleScrubResume.commit();
		expect(editorSession.isPlaying).toBe(true);
		expect(editorSession.playbackRate).toBe(-1);
		expect(editorSession.transportMode).toBe('shuttle');

		editorSession.stopPlayback();
		expect(editorSession.isPlaying).toBe(false);
		expect(editorSession.playbackRate).toBe(1);
		expect(editorSession.transportMode).toBe('normal');
		expect(editorSession.clock.currentFrame).toBe(0);
	});
});
