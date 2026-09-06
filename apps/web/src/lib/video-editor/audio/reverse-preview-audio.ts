import { reverseAudioWindow } from './reverse-audio';
import { getSharedPreviewAudioContext } from './preview-audio-graph';
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import { ensureAc3DecoderForCodec, isAc3AudioCodec } from '$lib/video-editor/media/ac3-decoder';

const decodedByUrl = new Map<string, Promise<AudioBuffer>>();
const reversedByWindow = new Map<string, Promise<AudioBuffer>>();

export function previewAudioContext(): AudioContext {
	const context = getSharedPreviewAudioContext();
	if (!context) throw new Error('Web Audio is unavailable in this browser.');
	return context;
}

async function decodeWithMediabunny(blob: Blob): Promise<AudioBuffer> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error('Preview source has no audio track.');
		await ensureAc3DecoderForCodec(track.codec);
		const chunks: Float32Array[][] = [];
		let totalFrames = 0;
		let sampleRate = track.sampleRate || 48_000;
		for await (const sample of new AudioSampleSink(track).samples()) {
			try {
				sampleRate = sample.sampleRate || sampleRate;
				const planes: Float32Array[] = [];
				for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
					const plane = new Float32Array(sample.numberOfFrames);
					sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
					planes.push(plane);
				}
				chunks.push(planes);
				totalFrames += sample.numberOfFrames;
			} finally {
				sample.close();
			}
		}
		const channelCount = Math.max(1, chunks[0]?.length ?? track.numberOfChannels ?? 1);
		const buffer = previewAudioContext().createBuffer(
			channelCount,
			Math.max(1, totalFrames),
			sampleRate
		);
		for (let channel = 0; channel < channelCount; channel += 1) {
			const output = buffer.getChannelData(channel);
			let offset = 0;
			for (const planes of chunks) {
				const plane = planes[channel] ?? planes[0];
				if (plane) output.set(plane, offset);
				offset += plane?.length ?? 0;
			}
		}
		return buffer;
	} finally {
		input.dispose?.();
	}
}

export async function decodedPreviewAudio(url: string, audioCodec?: string): Promise<AudioBuffer> {
	const key = `${audioCodec ?? ''}\u0000${url}`;
	let pending = decodedByUrl.get(key);
	if (!pending) {
		pending = fetch(url)
			.then((response) => {
				if (!response.ok) throw new Error(`Could not read preview audio (${response.status}).`);
				return response.blob();
			})
			.then(async (blob) => {
				if (isAc3AudioCodec(audioCodec)) return decodeWithMediabunny(blob);
				try {
					return await previewAudioContext().decodeAudioData(await blob.arrayBuffer());
				} catch {
					return decodeWithMediabunny(blob);
				}
			});
		decodedByUrl.set(key, pending);
		pending.catch(() => decodedByUrl.delete(key));
	}
	return pending;
}

/** Decode one source only once, then cache each exact reversed clip window. */
export async function reversedPreviewAudio(
	url: string,
	startSeconds: number,
	endSeconds: number,
	audioCodec?: string
): Promise<AudioBuffer> {
	const key = `${audioCodec ?? ''}\u0000${url}\u0000${startSeconds.toFixed(6)}\u0000${endSeconds.toFixed(6)}`;
	let pending = reversedByWindow.get(key);
	if (!pending) {
		pending = decodedPreviewAudio(url, audioCodec).then((decoded) => {
			const window = reverseAudioWindow(decoded, endSeconds, endSeconds - startSeconds);
			const audioContext = previewAudioContext();
			const buffer = audioContext.createBuffer(
				window.channels.length,
				Math.max(1, window.channels[0]?.length ?? 0),
				window.sampleRate
			);
			for (let channel = 0; channel < window.channels.length; channel++) {
				buffer.getChannelData(channel).set(window.channels[channel]!);
			}
			return buffer;
		});
		reversedByWindow.set(key, pending);
		pending.catch(() => reversedByWindow.delete(key));
	}
	return pending;
}
