/**
 * Live gain overrides for fader drag. During drag, track volumes update the
 * preview graph via this map without committing to the project snapshot.
 * On release the override clears and the committed store value takes over.
 * Keeps one atomic undo entry.
 */

const liveGains = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();
let version = 0;
const versionListeners = new Set<() => void>();

function notifyItem(itemId: string): void {
	const set = listeners.get(itemId);
	if (!set) return;
	for (const cb of [...set]) cb();
}

function notifyVersion(): void {
	version += 1;
	for (const cb of [...versionListeners]) cb();
}

export function setMixerLiveGain(itemId: string, gain: number): void {
	const prev = liveGains.get(itemId) ?? 1;
	if (Object.is(prev, gain)) return;
	if (gain === 1) liveGains.delete(itemId);
	else liveGains.set(itemId, gain);
	notifyItem(itemId);
	notifyVersion();
}

export function setMixerLiveGains(entries: Array<{ itemId: string; gain: number }>): void {
	let changed = false;
	for (const { itemId, gain } of entries) {
		const prev = liveGains.get(itemId) ?? 1;
		if (Object.is(prev, gain)) continue;
		if (gain === 1) liveGains.delete(itemId);
		else liveGains.set(itemId, gain);
		notifyItem(itemId);
		changed = true;
	}
	if (changed) notifyVersion();
}

export function clearMixerLiveGain(itemId: string): void {
	if (!liveGains.has(itemId)) return;
	liveGains.delete(itemId);
	notifyItem(itemId);
	notifyVersion();
}

export function clearMixerLiveGainsForItems(itemIds: string[]): void {
	let changed = false;
	for (const id of itemIds) {
		if (liveGains.delete(id)) {
			notifyItem(id);
			changed = true;
		}
	}
	if (changed) notifyVersion();
}

export function clearAllMixerLiveGains(): void {
	if (liveGains.size === 0) return;
	const ids = [...liveGains.keys()];
	liveGains.clear();
	for (const id of ids) notifyItem(id);
	notifyVersion();
}

export function getMixerLiveGain(itemId: string): number {
	return liveGains.get(itemId) ?? 1;
}

export function getLiveGainVersion(): number {
	return version;
}

export function subscribeLiveGainVersion(cb: () => void): () => void {
	versionListeners.add(cb);
	return () => versionListeners.delete(cb);
}

export function subscribeItemLiveGain(itemId: string, cb: () => void): () => void {
	let set = listeners.get(itemId);
	if (!set) {
		set = new Set();
		listeners.set(itemId, set);
	}
	set.add(cb);
	return () => {
		const s = listeners.get(itemId);
		if (!s) return;
		s.delete(cb);
		if (s.size === 0) listeners.delete(itemId);
	};
}

// Legacy helpers matching FreeCut naming.

export function getMixerLiveGainProduct(itemIds: readonly string[]): number {
	let product = 1;
	const seen = new Set<string>();
	for (const id of itemIds) {
		if (seen.has(id)) continue;
		seen.add(id);
		product *= getMixerLiveGain(id);
	}
	return product;
}
