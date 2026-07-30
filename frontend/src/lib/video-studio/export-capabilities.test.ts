import { describe, expect, it, vi } from 'vitest';
import {
	destinationVideoBitrate,
	exportVideoCandidates,
	probeExportEncoderPlan,
	type ExportCodecProbe
} from './export-capabilities';

describe('video export capabilities', () => {
	it('calculates a size-limited bitrate with container headroom', () => {
		expect(destinationVideoBitrate(100_000_000, 100, 128_000, 1_000_000, 12_000_000)).toBe(
			7_242_000
		);
		expect(destinationVideoBitrate(1_000_000, 100, 128_000, 1_000_000, 12_000_000)).toBeNull();
	});

	it('probes exact H.264 output configurations with no-preference first', () => {
		const candidates = exportVideoCandidates({
			format: 'mp4',
			width: 1080,
			height: 1920,
			frameRate: 60,
			videoBitrate: 12_000_000
		});
		expect(candidates[0]).toMatchObject({
			codec: 'avc',
			fullCodecString: 'avc1.64002a',
			hardwareAcceleration: 'no-preference',
			bitrate: 12_000_000
		});
		expect(candidates[1]?.fullCodecString).toBe('avc1.4d402a');
		expect(candidates.at(-1)?.bitrate).toBe(4_000_000);
	});

	it('uses the exact supported candidate instead of a generic capability result', async () => {
		const video = vi.fn(async (config: VideoEncoderConfig) => config.codec === 'avc1.4d402a');
		const probe: ExportCodecProbe = {
			video,
			audio: vi.fn(async () => true)
		};
		const plan = await probeExportEncoderPlan(
			{
				format: 'mp4',
				width: 1080,
				height: 1920,
				frameRate: 60,
				videoBitrate: 12_000_000,
				audioBitrate: 128_000,
				hasAudio: true
			},
			probe
		);
		expect(plan.fullCodecString).toBe('avc1.4d402a');
		expect(plan.hardwareAcceleration).toBe('no-preference');
		expect(video).toHaveBeenCalledTimes(2);
		expect(video.mock.calls[0]?.[0]).toMatchObject({
			width: 1080,
			height: 1920,
			framerate: 60,
			bitrate: 12_000_000,
			hardwareAcceleration: 'no-preference'
		});
	});

	it('reports an unsupported exact configuration before rendering', async () => {
		await expect(
			probeExportEncoderPlan(
				{
					format: 'mp4',
					width: 1080,
					height: 1920,
					frameRate: 60,
					videoBitrate: 12_000_000,
					audioBitrate: 128_000,
					hasAudio: false
				},
				{ video: async () => false, audio: async () => true }
			)
		).rejects.toThrow('cannot encode H.264 at 1080×1920, 60 fps');
	});
});
