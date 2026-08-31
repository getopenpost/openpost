/** Shared WebGPU device for transition pipeline per realm. One adapter/device per renderer realm. */

let devicePromise: Promise<GPUDevice | null> | null = null;
let deviceRef: GPUDevice | null = null;
let adapterRef: GPUAdapter | null = null;

function supportsGpuRealm(): boolean {
	return (
		typeof OffscreenCanvas === 'function' &&
		typeof globalThis.navigator !== 'undefined' &&
		typeof (globalThis.navigator as unknown as { gpu?: unknown }).gpu !== 'undefined' &&
		(globalThis.navigator as unknown as { gpu: GPU | undefined }).gpu !== undefined
	);
}

export function resetSharedTransitionDeviceForTests(): void {
	devicePromise = null;
	if (deviceRef) {
		try {
			deviceRef.destroy();
		} catch {
			// destroy idempotent
		}
	}
	deviceRef = null;
	adapterRef = null;
}

export function getSharedTransitionDeviceSync(): GPUDevice | null {
	return deviceRef;
}

export async function getSharedTransitionDevice(): Promise<GPUDevice | null> {
	if (devicePromise) return devicePromise;
	if (!supportsGpuRealm()) {
		devicePromise = Promise.resolve(null);
		return devicePromise;
	}
	const gpu = (globalThis.navigator as unknown as { gpu: GPU }).gpu;
	devicePromise = (async () => {
		try {
			const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
			if (!adapter) {
				adapterRef = null;
				return null;
			}
			adapterRef = adapter;
			const device = await adapter.requestDevice();
			deviceRef = device;
			// Mark lost -> clear cache so next ensure can retry or fallback deterministically
			device.lost?.then?.(() => {
				deviceRef = null;
				devicePromise = null;
				adapterRef = null;
			});
			return device;
		} catch {
			return null;
		}
	})();
	const device = await devicePromise;
	// If device already lost synchronously, clear
	if (!device) {
		devicePromise = Promise.resolve(null);
	}
	return device;
}

export function sharedDeviceStats(): { hasDevice: boolean; pending: boolean } {
	return { hasDevice: deviceRef !== null, pending: devicePromise !== null && deviceRef === null };
}
