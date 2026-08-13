/// <reference lib="webworker" />

import { scanMagicPixels, type MagicPixelScanInput } from './magic-scan-core';

type ScanRequest = MagicPixelScanInput & { type: 'scan'; id: string };
type CancelRequest = { type: 'cancel'; id: string };

const cancelled = new Set<string>();

self.onmessage = (event: MessageEvent<ScanRequest | CancelRequest>) => {
	const request = event.data;
	if (request.type === 'cancel') {
		cancelled.add(request.id);
		return;
	}
	void (async () => {
		try {
			const mask = await scanMagicPixels(request, {
				shouldCancel: () => cancelled.has(request.id),
				onProgress: (fraction) => self.postMessage({ type: 'progress', id: request.id, fraction })
			});
			self.postMessage({ type: 'complete', id: request.id, mask }, [mask.buffer]);
		} catch (cause) {
			self.postMessage({
				type: 'error',
				id: request.id,
				name: cause instanceof DOMException ? cause.name : 'Error',
				message: cause instanceof Error ? cause.message : 'Pixel scan failed.'
			});
		} finally {
			cancelled.delete(request.id);
		}
	})();
};

export {};
