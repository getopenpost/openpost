/// <reference lib="webworker" />

import type { VideoSource } from '@openpost/video-project';
import { generateProxy } from './artifacts';

type ProxyWorkerRequest =
	| {
			type: 'generate';
			projectID: string;
			source: VideoSource;
			file: File;
			identity: string;
	  }
	| { type: 'cancel' };

const worker = self as unknown as DedicatedWorkerGlobalScope;
let controller: AbortController | null = null;

worker.onmessage = (event: MessageEvent<ProxyWorkerRequest>) => {
	if (event.data.type === 'cancel') {
		controller?.abort(new DOMException('Cancelled', 'AbortError'));
		return;
	}
	if (controller) return;
	controller = new AbortController();
	void generateProxy(
		event.data.projectID,
		event.data.source,
		event.data.file,
		event.data.identity,
		controller.signal,
		(fraction) => worker.postMessage({ type: 'progress', fraction })
	)
		.then(() => worker.postMessage({ type: 'complete' }))
		.catch((cause: unknown) => {
			const error = cause instanceof Error ? cause : new Error(String(cause));
			worker.postMessage({ type: 'error', name: error.name, message: error.message });
		})
		.finally(() => {
			controller = null;
		});
};

export {};
