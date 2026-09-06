interface Waiter {
	resolve: (release: () => void) => void;
	reject: (error: DOMException) => void;
	signal: AbortSignal;
	onAbort: () => void;
}

/**
 * Serialize GPU-heavy media jobs across enhancement and local generation workers.
 * Running large models together adds memory pressure and makes every job complete later.
 */
class GpuMediaJobScheduler {
	private active = false;
	private readonly waiters: Waiter[] = [];

	acquire(signal: AbortSignal): Promise<() => void> {
		if (signal.aborted) {
			return Promise.reject(new DOMException('GPU media job was cancelled.', 'AbortError'));
		}
		return new Promise((resolve, reject) => {
			const waiter: Waiter = {
				resolve,
				reject,
				signal,
				onAbort: () => {
					const index = this.waiters.indexOf(waiter);
					if (index >= 0) this.waiters.splice(index, 1);
					reject(new DOMException('GPU media job was cancelled.', 'AbortError'));
				}
			};
			signal.addEventListener('abort', waiter.onAbort, { once: true });
			this.waiters.push(waiter);
			this.startNext();
		});
	}

	private startNext(): void {
		if (this.active) return;
		for (;;) {
			const waiter = this.waiters.shift();
			if (!waiter) return;
			waiter.signal.removeEventListener('abort', waiter.onAbort);
			if (waiter.signal.aborted) continue;
			this.active = true;
			let released = false;
			waiter.resolve(() => {
				if (released) return;
				released = true;
				this.active = false;
				this.startNext();
			});
			return;
		}
	}
}

export const gpuMediaJobScheduler = new GpuMediaJobScheduler();
