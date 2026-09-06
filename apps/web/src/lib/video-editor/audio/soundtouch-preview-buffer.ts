export interface SerializedSoundTouchPreviewSource {
	leftChannel: Float32Array;
	rightChannel: Float32Array;
	frameCount: number;
	sampleRate: number;
}

type PreparedSoundTouchPreviewSource = SerializedSoundTouchPreviewSource;

const preparedSourceCache = new WeakMap<
	AudioBuffer,
	Map<number, Promise<PreparedSoundTouchPreviewSource>>
>();

function resampleChannelLinear(
	input: Float32Array,
	targetFrames: number,
	ratio: number
): Float32Array {
	const output = new Float32Array(targetFrames);
	for (let i = 0; i < targetFrames; i++) {
		const sourcePosition = i / ratio;
		const index = Math.floor(sourcePosition);
		const fraction = sourcePosition - index;
		const first = input[index] ?? 0;
		const second = input[index + 1] ?? first;
		output[i] = first + (second - first) * fraction;
	}
	return output;
}

export function serializeAudioBufferForSoundTouchPreview(
	buffer: AudioBuffer,
	targetSampleRate: number
): SerializedSoundTouchPreviewSource {
	const safeTargetRate = Math.max(1, Math.floor(targetSampleRate));
	const leftSource = buffer.getChannelData(0);
	const rightSource = buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0);
	if (buffer.sampleRate === safeTargetRate) {
		return {
			leftChannel: new Float32Array(leftSource),
			rightChannel: new Float32Array(rightSource),
			frameCount: buffer.length,
			sampleRate: buffer.sampleRate
		};
	}
	const ratio = safeTargetRate / buffer.sampleRate;
	const targetFrames = Math.max(1, Math.ceil(buffer.length * ratio));
	return {
		leftChannel: resampleChannelLinear(leftSource, targetFrames, ratio),
		rightChannel: resampleChannelLinear(rightSource, targetFrames, ratio),
		frameCount: targetFrames,
		sampleRate: safeTargetRate
	};
}

async function prepareSource(
	buffer: AudioBuffer,
	targetSampleRate: number
): Promise<PreparedSoundTouchPreviewSource> {
	const safeTargetRate = Math.max(1, Math.floor(targetSampleRate));
	const cachedByRate = preparedSourceCache.get(buffer) ?? new Map();
	preparedSourceCache.set(buffer, cachedByRate);
	const cached = cachedByRate.get(safeTargetRate);
	if (cached) return cached;
	const task = (async () => {
		if (buffer.sampleRate === safeTargetRate) {
			return {
				leftChannel: buffer.getChannelData(0),
				rightChannel: buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0),
				frameCount: buffer.length,
				sampleRate: buffer.sampleRate
			};
		}
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- SSR and node tests do not expose the optional browser resampler.
		if (typeof OfflineAudioContext !== 'undefined') {
			const targetFrames = Math.max(
				1,
				Math.ceil(buffer.length * (safeTargetRate / buffer.sampleRate))
			);
			const context = new OfflineAudioContext(
				Math.max(1, Math.min(2, buffer.numberOfChannels)),
				targetFrames,
				safeTargetRate
			);
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.connect(context.destination);
			source.start();
			const rendered = await context.startRendering();
			return {
				leftChannel: rendered.getChannelData(0),
				rightChannel: rendered.getChannelData(rendered.numberOfChannels > 1 ? 1 : 0),
				frameCount: rendered.length,
				sampleRate: rendered.sampleRate
			};
		}
		return serializeAudioBufferForSoundTouchPreview(buffer, safeTargetRate);
	})().catch((error) => {
		cachedByRate.delete(safeTargetRate);
		throw error;
	});
	cachedByRate.set(safeTargetRate, task);
	return task;
}

/** Return independent transferable channel copies backed by a shared decode cache. */
export async function prepareAudioBufferForSoundTouchPreview(
	buffer: AudioBuffer,
	targetSampleRate: number
): Promise<SerializedSoundTouchPreviewSource> {
	const prepared = await prepareSource(buffer, targetSampleRate);
	return {
		leftChannel: new Float32Array(prepared.leftChannel),
		rightChannel: new Float32Array(prepared.rightChannel),
		frameCount: prepared.frameCount,
		sampleRate: prepared.sampleRate
	};
}
