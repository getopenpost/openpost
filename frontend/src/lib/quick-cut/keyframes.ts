import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny';

export async function extractKeyframeTimestamps(
	file: File,
	signal?: AbortSignal
): Promise<number[]> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) return [];
		const sink = new EncodedPacketSink(videoTrack);
		const packets: number[] = [];
		for await (const packet of sink.packets(undefined, undefined, { verifyKeyPackets: false })) {
			signal?.throwIfAborted();
			if (packet.type === 'key') packets.push(packet.timestamp);
		}
		packets.sort((a, b) => a - b);
		return packets;
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
