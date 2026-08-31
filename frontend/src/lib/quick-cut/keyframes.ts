import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny';

interface KeyPacketLike {
	timestamp: number;
	type: 'key' | 'delta';
}

interface KeyPacketNavigator<TPacket extends KeyPacketLike> {
	getFirstPacket(options: { verifyKeyPackets: boolean }): Promise<TPacket | null>;
	getNextKeyPacket(
		packet: TPacket,
		options: { verifyKeyPackets: boolean }
	): Promise<TPacket | null>;
}

export async function collectKeyframeTimestamps<TPacket extends KeyPacketLike>(
	sink: KeyPacketNavigator<TPacket>,
	signal?: AbortSignal
): Promise<number[]> {
	const timestamps: number[] = [];
	let packet = await sink.getFirstPacket({ verifyKeyPackets: true });
	while (packet) {
		signal?.throwIfAborted();
		if (packet.type === 'key') timestamps.push(packet.timestamp);
		packet = await sink.getNextKeyPacket(packet, { verifyKeyPackets: true });
	}
	return timestamps;
}

export async function extractKeyframeTimestamps(
	file: File,
	signal?: AbortSignal
): Promise<number[]> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) return [];
		const sink = new EncodedPacketSink(videoTrack);
		return await collectKeyframeTimestamps(sink, signal);
	} finally {
		try {
			input.dispose?.();
		} catch {
			// ignore
		}
	}
}

export async function computeDuration(file: File): Promise<number> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		return await input.computeDuration();
	} finally {
		try {
			input.dispose?.();
		} catch {
			// ignore
		}
	}
}
