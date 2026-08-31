import { describe, expect, it } from 'vitest';
import {
	getBrowserMediaPlaybackRate,
	getShuttleMediaPlaybackRate,
	isReverseShuttleRate,
	isShuttleActive
} from './shuttle';
import { resolveReverseShuttleGrainPlan } from '../audio/reverse-shuttle-grain';
import { resolveAudioOwner } from './audio-owner';
import type { MediaPoolEntry } from '../media/pool.svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';

function makeMediaEntry(audioCodec: string | undefined = 'aac'): MediaPoolEntry {
	return {
		media: {
			id: 'm1',
			fileName: 'clip.mp4',
			fileSize: 1000,
			mimeType: 'video/mp4',
			duration: 10,
			width: 1920,
			height: 1080,
			fps: 30,
			codec: 'avc',
			bitrate: 5000,
			audioCodec,
			audioCodecSupported: true,
			storageType: 'workspace',
			tags: []
		} as unknown as MediaPoolEntry['media'],
		status: 'ready',
		progress: 1
	};
}

describe('shuttle shared controller coverage for every media path', () => {
	it('computes positive clamped media rate from authored * abs(transport) for visual and audio', () => {
		// Preview-layer visual: authored 1 at 2x shuttle => 2
		expect(getShuttleMediaPlaybackRate(1, -2)).toBe(2);
		expect(getShuttleMediaPlaybackRate(2, -2)).toBe(4);
		expect(getShuttleMediaPlaybackRate(0.5, -4)).toBe(2);
		// Audio mix entry with authored 0.5 and transport -4 => 2
		expect(getShuttleMediaPlaybackRate(0.5, -4)).toBe(2);
		// Source monitor native positive path uses abs as well
		expect(getShuttleMediaPlaybackRate(1, 4)).toBe(4);
		// Clamping to 0.0625..16: 10 * 10 would be 100 -> 16
		expect(getShuttleMediaPlaybackRate(10, -10)).toBe(16);
		expect(getShuttleMediaPlaybackRate(0.01, -0.01)).toBe(0.0625);
	});

	it('distinguishes reverse from forward via shared helper', () => {
		expect(isReverseShuttleRate(-1)).toBe(true);
		expect(isReverseShuttleRate(-4)).toBe(true);
		expect(isReverseShuttleRate(1)).toBe(false);
		expect(isReverseShuttleRate(0)).toBe(false);
		expect(isShuttleActive(-1, true)).toBe(true);
		expect(isShuttleActive(2, true)).toBe(true);
		expect(isShuttleActive(1, true)).toBe(false);
		expect(isShuttleActive(-1, false)).toBe(false);
	});

	it('re-seek drift threshold scales inversely with shuttle rate', () => {
		const drift = (authored: number, transport: number) =>
			0.08 / Math.max(0.1, getShuttleMediaPlaybackRate(authored, transport));
		// Used by preview-layer, preview-audio-layer, preview-mix-entry-layer, source-monitor
		expect(drift(1, 1)).toBeCloseTo(0.08);
		expect(drift(1, 2)).toBeCloseTo(0.04);
		expect(drift(1, 4)).toBeCloseTo(0.02);
		// Higher rate => smaller tolerance, so existing drift becomes significant
		expect(drift(1, 2)).toBeLessThan(drift(1, 1));
		expect(drift(1, 4)).toBeLessThan(drift(1, 2));
	});

	it('shared audio-owner decides who routes reverse grains for each media path', () => {
		const entry = makeMediaEntry('aac');
		const track = {
			id: 't1',
			name: 'Video',
			height: 60,
			locked: false,
			visible: true,
			muted: false
		} as TimelineTrack;
		// Preview-layer: video with embedded audio owns grains
		expect(
			resolveAudioOwner({
				item: {
					id: 'v1',
					trackId: 't1',
					from: 0,
					durationInFrames: 100,
					label: 'v',
					type: 'video',
					mediaId: 'm1'
				} as TimelineItem,
				tracks: [track],
				allItems: [],
				mediaEntry: entry,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			})
		).toBe('embedded');
		// Preview-audio-layer: processed item owns its own grains
		expect(
			resolveAudioOwner({
				item: { id: 'v1', trackId: 't1', from: 0, durationInFrames: 100, label: 'v', type: 'video', mediaId: 'm1' } as TimelineItem,
				tracks: [track],
				allItems: [],
				mediaEntry: entry,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: true
			})
		).toBe('processed');
		// Mix entry separate proxy not used for preview-layer but for nested audio
		expect(
			resolveAudioOwner({
				item: { id: 'v1', trackId: 't1', from: 0, durationInFrames: 100, label: 'v', type: 'video', mediaId: 'm1' } as TimelineItem,
				tracks: [track],
				allItems: [],
				mediaEntry: entry,
				usesSeparateProxyAudio: true,
				usesProcessedAudio: false
			})
		).toBe('separateProxy');
		// Source monitor audio-only uses embedded
		expect(
			resolveAudioOwner({
				item: { id: 'a1', trackId: 't1', from: 0, durationInFrames: 100, label: 'a', type: 'audio', mediaId: 'm1' } as TimelineItem,
				tracks: [track],
				allItems: [],
				mediaEntry: entry,
				usesSeparateProxyAudio: false,
				usesProcessedAudio: false
			})
		).toBe('embedded');
	});

	it('reverse grain ordering for normal vs authored-reversed clips across controller', () => {
		const normal = resolveReverseShuttleGrainPlan({
			sourceCursorSeconds: 5,
			authoredPlaybackRate: 1,
			transportPlaybackRate: -2,
			authoredReversed: false,
			bufferStartSeconds: 0,
			bufferDurationSeconds: 10
		});
		const reversed = resolveReverseShuttleGrainPlan({
			sourceCursorSeconds: 5,
			authoredPlaybackRate: 1,
			transportPlaybackRate: -2,
			authoredReversed: true,
			bufferStartSeconds: 0,
			bufferDurationSeconds: 10
		});
		expect(normal?.reverseSamples).toBe(true);
		expect(reversed?.reverseSamples).toBe(false);
		expect(normal?.sourceStartSeconds).toBeLessThan(5);
		expect(reversed?.sourceStartSeconds).toBe(5);
		expect(normal?.playbackRate).toBe(2);
		expect(reversed?.playbackRate).toBe(2);
		// Forward shuttle never uses reverseSamples
		expect(
			resolveReverseShuttleGrainPlan({
				sourceCursorSeconds: 5,
				authoredPlaybackRate: 1,
				transportPlaybackRate: 2,
				authoredReversed: false,
				bufferStartSeconds: 0,
				bufferDurationSeconds: 10
			})?.playbackRate
		).toBe(2);
	});

	it('clamps authored*transport via shared helper for every path', () => {
		expect(getBrowserMediaPlaybackRate(10, 10)).toBe(16);
		expect(getShuttleMediaPlaybackRate(10, -10)).toBe(16);
		expect(getBrowserMediaPlaybackRate(0.001, 0.001)).toBe(0.0625);
		expect(getShuttleMediaPlaybackRate(2, 4)).toBe(8);
	});
});
