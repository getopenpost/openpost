import { expect, it } from 'vitest';
import { tick } from 'svelte';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import PreviewPlayer from './preview-player.svelte';
import { editorSession } from '../editor.svelte';
import { createBlankProject } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { mediaPool } from '../media/pool.svelte';
import { peekSharedPreviewAudioContext } from '../audio/preview-audio-graph';
import { readMixerMasterLevels } from '../audio/audio-mixer';
import { previewPlaybackSettings } from '../preview/playback-settings.svelte';
import { clearPreviewDecoderPrewarm, prewarmPreviewFrame } from '../preview/decoder-prewarm-client';
import fixtureUrl from '../../../../../../tests/app/fixtures/product-screenshots/study-sos-demo.mp4?url';
import '../../../routes/layout.css';

it.each(['auto', 'full'] as const)(
	'keeps video and audio playing across a source cut at %s quality',
	async (quality) => {
		await page.viewport(1000, 650);
		const previousQuality = previewPlaybackSettings.previewQuality;
		previewPlaybackSettings.setPreviewQuality(quality);
		const project = createBlankProject('Cut playback');
		project.timeline!.items = [
			{
				id: 'before',
				type: 'video',
				label: 'Before',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 30,
				mediaId: 'cut-video',
				sourceStart: 0,
				sourceEnd: 30,
				sourceFps: 30
			},
			{
				id: 'after',
				type: 'video',
				label: 'After',
				trackId: 'track-video-main',
				from: 30,
				durationInFrames: 60,
				mediaId: 'cut-video',
				sourceStart: 60,
				sourceEnd: 120,
				sourceFps: 30
			}
		];
		const media = {
			id: 'cut-video',
			storageType: 'cloud' as const,
			remoteUrl: fixtureUrl,
			fileName: 'cut.mp4',
			fileSize: 185000,
			mimeType: 'video/mp4',
			duration: 8,
			width: 640,
			height: 360,
			fps: 30,
			codec: 'avc',
			bitrate: 100000,
			hasAudio: true,
			tags: []
		};
		mediaPool.loadAll([media]);
		editorSession.project = project;
		sequenceStore.load(project.timeline!, project.metadata);
		await prewarmPreviewFrame(media, 2);
		const screen = await render(PreviewPlayer, { onedit: () => {} });
		screen.container.style.cssText = 'display:flex;width:960px;height:600px';
		const blankFrames: number[] = [];
		const pixels = document.createElement('canvas');
		pixels.width = 64;
		pixels.height = 36;
		const context = pixels.getContext('2d')!;
		let sampling = true;
		let sampled = 0;
		let audioPeak = 0;
		const sample = async () => {
			await tick();
			if (!sampling) return;
			const levels = readMixerMasterLevels();
			audioPeak = Math.max(audioPeak, levels.peakLeft, levels.peakRight);
			const frame = timelineStore.currentFrame;
			if (frame >= 30 && frame < 40) {
				sampled++;
				const layer = screen.container.querySelector('[data-preview-item="after"]');
				const video = layer?.querySelector('video');
				const fallback = layer?.querySelector<HTMLCanvasElement>('[data-seek-fallback]');
				context.clearRect(0, 0, pixels.width, pixels.height);
				if (
					video &&
					video.checkVisibility({ visibilityProperty: true, opacityProperty: true }) &&
					video.videoWidth > 0
				)
					try {
						context.drawImage(video, 0, 0, pixels.width, pixels.height);
					} catch (error) {
						if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') throw error;
					}
				if (
					fallback &&
					!fallback.hidden &&
					fallback.checkVisibility({ visibilityProperty: true, opacityProperty: true }) &&
					fallback.width > 0
				)
					context.drawImage(fallback, 0, 0, pixels.width, pixels.height);
				// This fixture contains a lit screen and face through the cut. Inspect
				// drawable RGB pixels, since a pending seek may still retain a frame.
				const hasPicture = context
					.getImageData(0, 0, pixels.width, pixels.height)
					.data.some((value, index) => index % 4 !== 3 && value > 32);
				if (!hasPicture) blankFrames.push(frame);
			}
			requestAnimationFrame(sample);
		};
		try {
			await expect
				.poll(() => screen.container.querySelector('video')?.readyState)
				.toBeGreaterThanOrEqual(2);
			await peekSharedPreviewAudioContext()?.suspend();
			await userEvent.click(screen.container);
			requestAnimationFrame(sample);
			editorSession.clock.seek(20);
			editorSession.startPlayback({ start: 20, end: 50 });
			await expect
				.poll(() => timelineStore.currentFrame, { timeout: 5000 })
				.toBeGreaterThanOrEqual(45);
			expect(sampled).toBeGreaterThan(0);
			expect(audioPeak).toBeGreaterThan(0);
			expect(blankFrames).toEqual([]);
		} finally {
			sampling = false;
			editorSession.stopPlayback();
			await screen.unmount();
			clearPreviewDecoderPrewarm();
			mediaPool.clear();
			timelineStore.__resetForTesting();
			sequenceStore.reset();
			editorSession.project = null;
			previewPlaybackSettings.setPreviewQuality(previousQuality);
		}
	},
	30000
);
