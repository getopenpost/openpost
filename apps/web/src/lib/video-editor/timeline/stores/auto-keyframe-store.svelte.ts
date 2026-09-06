/** Per-item, per-property auto-key state. Ported from FreeCut (MIT). */
import type { KeyframeProperty } from '$lib/video-editor/project/types';

let enabled = $state(new Set<string>());

function key(itemId: string, property: KeyframeProperty): string {
	return `${itemId}:${property}`;
}

export const autoKeyframeStore = {
	isEnabled(itemId: string, property: KeyframeProperty): boolean {
		return enabled.has(key(itemId, property));
	},
	toggle(itemId: string, property: KeyframeProperty): boolean {
		const id = key(itemId, property);
		const next = new Set(enabled);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		enabled = next;
		return next.has(id);
	},
	reset(): void {
		enabled = new Set();
	}
};
