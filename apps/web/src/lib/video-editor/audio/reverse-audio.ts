/** A decoded audio buffer shape small enough to test without Web Audio globals. */
export interface DecodedAudioWindowSource {
	length: number;
	numberOfChannels: number;
	sampleRate: number;
	getChannelData(channel: number): Float32Array;
}

export interface ReversedAudioWindow {
	channels: Float32Array[];
	sampleRate: number;
}

/** Copy and reverse an exact source-time window, one PCM frame at a time. */
export function reverseAudioWindow(
	buffer: DecodedAudioWindowSource,
	endSeconds: number,
	durationSeconds: number
): ReversedAudioWindow {
	const endFrame = Math.min(buffer.length, Math.max(0, Math.round(endSeconds * buffer.sampleRate)));
	const requestedFrames = Math.max(0, Math.round(durationSeconds * buffer.sampleRate));
	const startFrame = Math.max(0, endFrame - requestedFrames);
	const frameCount = endFrame - startFrame;
	const channels: Float32Array[] = [];
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const source = buffer.getChannelData(channel);
		const reversed = new Float32Array(frameCount);
		for (let frame = 0; frame < frameCount; frame++) {
			reversed[frame] = source[endFrame - frame - 1] ?? 0;
		}
		channels.push(reversed);
	}
	return { channels, sampleRate: buffer.sampleRate };
}
