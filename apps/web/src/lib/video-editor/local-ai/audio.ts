function writeAscii(view: DataView, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) {
		view.setUint8(offset + index, value.charCodeAt(index));
	}
}

export function concatenateFloat32(chunks: Float32Array[]): Float32Array {
	const result = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

/** Encode channel-aligned float PCM as an interleaved IEEE float WAV file. */
export function createFloat32WavBlob(channels: Float32Array[], sampleRate: number): Blob {
	if (channels.length === 0) throw new Error('Audio has no channels.');
	if (!Number.isFinite(sampleRate) || sampleRate <= 0)
		throw new Error('Audio sample rate is invalid.');
	const frameCount = channels[0]?.length ?? 0;
	if (frameCount === 0) throw new Error('Audio has no samples.');
	if (channels.some((channel) => channel.length !== frameCount)) {
		throw new Error('Audio channels have different lengths.');
	}

	const channelCount = channels.length;
	const bytesPerSample = 4;
	const blockAlign = channelCount * bytesPerSample;
	const dataSize = frameCount * blockAlign;
	const header = new ArrayBuffer(44);
	const view = new DataView(header);
	writeAscii(view, 0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	writeAscii(view, 8, 'WAVE');
	writeAscii(view, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 3, true);
	view.setUint16(22, channelCount, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * blockAlign, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, 32, true);
	writeAscii(view, 36, 'data');
	view.setUint32(40, dataSize, true);

	const interleaved = new Float32Array(frameCount * channelCount);
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			interleaved[frame * channelCount + channel] = channels[channel]?.[frame] ?? 0;
		}
	}
	return new Blob([header, interleaved.buffer], { type: 'audio/wav' });
}

export function audioDurationSeconds(channels: Float32Array[], sampleRate: number): number {
	return sampleRate > 0 ? (channels[0]?.length ?? 0) / sampleRate : 0;
}

export function applyPlaybackSpeed(
	channels: Float32Array[],
	speed: number,
	minimum = 0.5,
	maximum = 2
): Float32Array[] {
	const normalized = Number.isFinite(speed) ? Math.min(maximum, Math.max(minimum, speed)) : 1;
	if (Math.abs(normalized - 1) < 0.001) return channels;
	return channels.map((channel) => {
		if (channel.length <= 1) return channel;
		const outputLength = Math.max(1, Math.floor((channel.length - 1) / normalized) + 1);
		const output = new Float32Array(outputLength);
		for (let index = 0; index < outputLength; index += 1) {
			const sourcePosition = index * normalized;
			const startIndex = Math.floor(sourcePosition);
			const endIndex = Math.min(channel.length - 1, startIndex + 1);
			const fraction = sourcePosition - startIndex;
			const start = channel[startIndex] ?? 0;
			output[index] = start + ((channel[endIndex] ?? start) - start) * fraction;
		}
		return output;
	});
}
