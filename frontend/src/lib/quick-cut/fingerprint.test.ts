import { describe, expect, it } from 'vitest';
import { createHash } from './fingerprint';

function fileWithByteAt(index?: number, value = 7): File {
	const bytes = new Uint8Array(256 * 1024);
	bytes.fill(7);
	if (index !== undefined) bytes[index] = value;
	return new File([bytes], 'source.mp4', { type: 'video/mp4', lastModified: 1 });
}

describe('quick-cut source fingerprint', () => {
	it('detects changes outside the first sample window', async () => {
		const original = fileWithByteAt();
		const changedMiddle = fileWithByteAt(128 * 1024, 9);
		const changedTail = fileWithByteAt(240 * 1024, 9);
		const originalHash = await createHash(original);
		expect(await createHash(changedMiddle)).not.toBe(originalHash);
		expect(await createHash(changedTail)).not.toBe(originalHash);
		expect(originalHash).toMatch(/^[0-9a-f]{64}$/u);
	});
});
