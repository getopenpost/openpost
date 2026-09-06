import { describe, expect, it, vi } from 'vitest';
import { collectKeyframeTimestamps } from './keyframes';

interface Packet {
	timestamp: number;
	type: 'key' | 'delta';
}

describe('Quick Cut keyframe indexing', () => {
	it('walks only verified key packets instead of scanning every frame', async () => {
		const first: Packet = { timestamp: 0, type: 'delta' };
		const keyOne: Packet = { timestamp: 1, type: 'key' };
		const keyThree: Packet = { timestamp: 3, type: 'key' };
		const getNextKeyPacket = vi
			.fn<(packet: Packet, options: { verifyKeyPackets: boolean }) => Promise<Packet | null>>()
			.mockResolvedValueOnce(keyOne)
			.mockResolvedValueOnce(keyThree)
			.mockResolvedValueOnce(null);

		const timestamps = await collectKeyframeTimestamps({
			getFirstPacket: vi.fn(async () => first),
			getNextKeyPacket
		});

		expect(timestamps).toEqual([1, 3]);
	});

	it('stops between key packets when indexing is cancelled', async () => {
		const controller = new AbortController();
		const first: Packet = { timestamp: 0, type: 'key' };
		const second: Packet = { timestamp: 2, type: 'key' };
		const getNextKeyPacket = vi.fn(async () => {
			controller.abort(new DOMException('cancelled', 'AbortError'));
			return second;
		});

		await expect(
			collectKeyframeTimestamps(
				{ getFirstPacket: vi.fn(async () => first), getNextKeyPacket },
				controller.signal
			)
		).rejects.toMatchObject({ name: 'AbortError' });
	});
});
