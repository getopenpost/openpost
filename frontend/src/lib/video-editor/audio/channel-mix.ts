function abortIfNeeded(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Channel mix cancelled', 'AbortError');
}

export function mixChannelsSync(channels: Float32Array[]): Float32Array {
	if (channels.length === 0) return new Float32Array(0);
	if (channels.length === 1) {
		// SAFETY: channels length checked above, first entry is defined
		return new Float32Array(channels[0]!);
	}
	const length = channels[0]?.length ?? 0;
	const mono = new Float32Array(length);
	for (const channel of channels) {
		for (let i = 0; i < length; i++) mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0);
	}
	const divisor = channels.length;
	for (let i = 0; i < length; i++) mono[i] = (mono[i] ?? 0) / divisor;
	return mono;
}

export function extractChannels(buffer: AudioBuffer): Float32Array[] {
	const channels: Float32Array[] = [];
	for (let index = 0; index < buffer.numberOfChannels; index++) {
		channels.push(new Float32Array(buffer.getChannelData(index)));
	}
	return channels;
}

export async function mixAudioBufferCooperative(
	buffer: AudioBuffer,
	signal?: AbortSignal
): Promise<Float32Array> {
	abortIfNeeded(signal);
	if (buffer.numberOfChannels === 0) return new Float32Array(0);
	if (buffer.numberOfChannels === 1) return new Float32Array(buffer.getChannelData(0));
	const length = buffer.length;
	const mono = new Float32Array(length);
	const channels = buffer.numberOfChannels;
	const chunkSize = 8192;
	for (let channel = 0; channel < channels; channel++) {
		const data = buffer.getChannelData(channel);
		for (let offset = 0; offset < length; offset += chunkSize) {
			abortIfNeeded(signal);
			const end = Math.min(length, offset + chunkSize);
			for (let i = offset; i < end; i++) mono[i] = (mono[i] ?? 0) + (data[i] ?? 0);
			if (offset % (chunkSize * 8) === 0) {
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
				abortIfNeeded(signal);
			}
		}
	}
	const divisor = channels;
	for (let offset = 0; offset < length; offset += chunkSize) {
		abortIfNeeded(signal);
		const end = Math.min(length, offset + chunkSize);
		for (let i = offset; i < end; i++) mono[i] = (mono[i] ?? 0) / divisor;
		if (offset % (chunkSize * 8) === 0) {
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			abortIfNeeded(signal);
		}
	}
	return mono;
}

export async function mixChannelsCooperative(
	channels: Float32Array[],
	signal?: AbortSignal
): Promise<Float32Array> {
	abortIfNeeded(signal);
	if (channels.length === 0) return new Float32Array(0);
	if (channels.length === 1) {
		// SAFETY: channels length checked above, first entry is defined
		return new Float32Array(channels[0]!);
	}
	const length = channels[0]?.length ?? 0;
	const mono = new Float32Array(length);
	const chunkSize = 8192;
	for (const channel of channels) {
		for (let offset = 0; offset < length; offset += chunkSize) {
			abortIfNeeded(signal);
			const end = Math.min(length, offset + chunkSize);
			for (let i = offset; i < end; i++) mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0);
			if (offset % (chunkSize * 8) === 0) {
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
				abortIfNeeded(signal);
			}
		}
	}
	const divisor = channels.length;
	for (let offset = 0; offset < length; offset += chunkSize) {
		abortIfNeeded(signal);
		const end = Math.min(length, offset + chunkSize);
		for (let i = offset; i < end; i++) mono[i] = (mono[i] ?? 0) / divisor;
		if (offset % (chunkSize * 8) === 0) {
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			abortIfNeeded(signal);
		}
	}
	return mono;
}
