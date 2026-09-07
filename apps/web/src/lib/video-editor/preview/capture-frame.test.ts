import { describe, expect, it } from 'vitest';
import {
	MAX_LIVE_PLAYBACK_CAPTURE_DRIFT_FRAMES,
	resolvePreviewCaptureFrame
} from './capture-frame';

describe('resolvePreviewCaptureFrame', () => {
	it('prefers the live playback frame while playing within drift', () => {
		expect(
			resolvePreviewCaptureFrame({
				currentFrame: 100,
				previewFrame: null,
				isPlaying: true,
				livePlaybackFrame: 100 + MAX_LIVE_PLAYBACK_CAPTURE_DRIFT_FRAMES
			})
		).toBe(100 + MAX_LIVE_PLAYBACK_CAPTURE_DRIFT_FRAMES);
	});

	it('falls back to the committed frame while playing outside drift', () => {
		expect(
			resolvePreviewCaptureFrame({
				currentFrame: 100,
				previewFrame: null,
				isPlaying: true,
				livePlaybackFrame: 100 + MAX_LIVE_PLAYBACK_CAPTURE_DRIFT_FRAMES + 1
			})
		).toBe(100);
	});

	it('uses the committed frame while playing without a live frame', () => {
		expect(
			resolvePreviewCaptureFrame({ currentFrame: 42, previewFrame: 90, isPlaying: true })
		).toBe(42);
	});

	it('uses the preview/scrub frame while paused', () => {
		expect(
			resolvePreviewCaptureFrame({ currentFrame: 42, previewFrame: 90, isPlaying: false })
		).toBe(90);
	});

	it('falls back to the committed frame while paused without a preview frame', () => {
		expect(
			resolvePreviewCaptureFrame({ currentFrame: 42, previewFrame: null, isPlaying: false })
		).toBe(42);
	});

	it('normalizes non-finite and negative frames to zero', () => {
		expect(
			resolvePreviewCaptureFrame({
				currentFrame: Number.NaN,
				previewFrame: null,
				isPlaying: false
			})
		).toBe(0);
		expect(
			resolvePreviewCaptureFrame({ currentFrame: -5, previewFrame: null, isPlaying: true })
		).toBe(0);
	});
});
