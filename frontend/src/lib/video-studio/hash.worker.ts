/// <reference lib="webworker" />

import { sha256 } from '@noble/hashes/sha2.js';

interface HashRequest {
	id: string;
	file: File;
}

self.onmessage = (event: MessageEvent<HashRequest>) => {
	void hashFile(event.data);
};

async function hashFile({ id, file }: HashRequest): Promise<void> {
	try {
		const hash = sha256.create();
		const reader = file.stream().getReader();
		let processed = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			hash.update(value);
			processed += value.byteLength;
			postMessage({ type: 'progress', id, processed, total: file.size });
		}
		postMessage({ type: 'complete', id, sha256: hex(hash.digest()) });
	} catch (cause) {
		postMessage({
			type: 'error',
			id,
			message: cause instanceof Error ? cause.message : 'The source hash could not be calculated.'
		});
	}
}

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export {};
