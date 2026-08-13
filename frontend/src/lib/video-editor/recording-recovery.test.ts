import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RecordingChunkManifest } from './types';

vi.stubGlobal('crypto', webcrypto);

const { verifyContiguousRecordingChunks } = await import('./recording-recovery');

describe('OpenPost Video Editor recording recovery', () => {
	it('stops at the first checksum mismatch and preserves earlier chunks', async () => {
		const first = new TextEncoder().encode('verified-cluster');
		const second = new TextEncoder().encode('corrupt-tail');
		const file = new File([first, second], 'recording.webm', { type: 'video/webm' });
		const chunks: RecordingChunkManifest[] = [
			{
				index: 0,
				timestamp_us: 1_000_000,
				position: 0,
				size_bytes: first.byteLength,
				sha256: await digest(first),
				media_start_us: 0,
				media_end_us: 1_000_000,
				session_start_us: 2_000_000,
				session_end_us: 3_000_000,
				flush_sequence: 1
			},
			{
				index: 1,
				timestamp_us: 2_000_000,
				position: first.byteLength,
				size_bytes: second.byteLength,
				sha256: '00'.repeat(32),
				media_start_us: 1_000_000,
				media_end_us: 2_000_000,
				session_start_us: 3_000_000,
				session_end_us: 4_000_000,
				flush_sequence: 2
			}
		];

		await expect(verifyContiguousRecordingChunks(file, chunks)).resolves.toEqual([chunks[0]]);
	});

	it('rejects a byte-range gap even when later data has a valid checksum', async () => {
		const data = new TextEncoder().encode('recording');
		const file = new File([data], 'recording.webm', { type: 'video/webm' });
		const chunk: RecordingChunkManifest = {
			index: 0,
			timestamp_us: 1_000_000,
			position: 1,
			size_bytes: data.byteLength - 1,
			sha256: await digest(data.slice(1)),
			media_start_us: 0,
			media_end_us: 1_000_000,
			session_start_us: 0,
			session_end_us: 1_000_000,
			flush_sequence: 1
		};

		await expect(verifyContiguousRecordingChunks(file, [chunk])).resolves.toEqual([]);
	});
});

async function digest(bytes: Uint8Array): Promise<string> {
	const hash = await webcrypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
