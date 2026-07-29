/// <reference lib="webworker" />

interface RemoveRequest {
	type: 'remove';
	image: Blob;
	publicPath: string;
	preferGPU: boolean;
}

self.onmessage = async (event: MessageEvent<RemoveRequest>) => {
	if (event.data.type !== 'remove') return;
	try {
		const { removeBackground } = await import('@imgly/background-removal');
		const run = (device: 'gpu' | 'cpu') =>
			removeBackground(event.data.image, {
				publicPath: event.data.publicPath,
				device,
				model: 'isnet_quint8',
				proxyToWorker: false,
				output: { format: 'image/png', quality: 1 },
				progress(key: string, current: number, total: number) {
					self.postMessage({
						type: 'progress',
						key,
						current,
						total,
						progress: total > 0 ? current / total : 0
					});
				}
			});
		let result: Blob;
		if (event.data.preferGPU) {
			try {
				result = await run('gpu');
			} catch {
				self.postMessage({ type: 'progress', key: 'Using CPU fallback', current: 0, total: 1 });
				result = await run('cpu');
			}
		} else {
			result = await run('cpu');
		}
		self.postMessage({ type: 'complete', result });
	} catch (error) {
		self.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : 'Background removal failed.'
		});
	}
};

export {};
