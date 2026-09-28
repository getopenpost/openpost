import { expect, it } from 'vitest';
import { mixAudioWindows } from './bounded-audio-mixer';
import { planMixdown } from '../media/render-plan';
import { mediaPool } from '../media/pool.svelte';
import { createDefaultTracks } from '../project/defaults';
function wav(sampleCount: number) {
	const b = new ArrayBuffer(44 + sampleCount * 2);
	const v = new DataView(b);
	const str = (off: number, s: string) => {
		for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
	};
	str(0, 'RIFF');
	v.setUint32(4, b.byteLength - 8, true);
	str(8, 'WAVE');
	str(12, 'fmt ');
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true);
	v.setUint16(22, 1, true);
	v.setUint32(24, 44100, true);
	v.setUint32(28, 88200, true);
	v.setUint16(32, 2, true);
	v.setUint16(34, 16, true);
	str(36, 'data');
	v.setUint32(40, sampleCount * 2, true);
	for (let i = 0; i < sampleCount; i++) v.setInt16(44 + i * 2, 8192, true);
	return new Blob([b], { type: 'audio/wav' });
}

it.each([128, 129, 180])('handles source EOF for a %i-frame clip', async (frames) => {
	const blob = wav(189000);
	const url = URL.createObjectURL(blob);
	const id = crypto.randomUUID();
	mediaPool.upsert(
		{
			id,
			fileName: 'speech.wav',
			fileSize: blob.size,
			mimeType: 'audio/wav',
			storageType: 'cloud',
			remoteUrl: url,
			duration: 189000 / 44100,
			width: 0,
			height: 0,
			fps: 0,
			codec: '',
			bitrate: 705600,
			audioCodec: 'pcm-s16',
			tags: ['audio']
		},
		'ready'
	);
	const tracks = createDefaultTracks();
	const entries = planMixdown(
		[
			{
				id,
				mediaId: id,
				trackId: tracks.find((t) => t.kind === 'audio')!.id,
				type: 'audio',
				label: 'Speech',
				from: 0,
				durationInFrames: frames,
				sourceStart: 0,
				sourceEnd: frames,
				sourceFps: 30
			}
		],
		tracks,
		30
	);
	const mix = async () => {
		const samples: number[] = [];
		for await (const w of mixAudioWindows(entries, frames / 30))
			for (const sample of w.samples[0]!) samples.push(sample);
		return samples;
	};
	try {
		if (frames === 180) await expect(mix()).rejects.toThrow('ended before');
		else {
			const samples = await mix();
			expect(samples).toHaveLength(frames * 1600);
			expect(samples[48000]).toBeCloseTo(0.25, 3);
			if (frames === 129) {
				expect(samples[205600]).toBeCloseTo(0.25, 3);
				expect(samples.slice(205750).every((sample) => sample === 0)).toBe(true);
			}
		}
	} finally {
		URL.revokeObjectURL(url);
	}
});
