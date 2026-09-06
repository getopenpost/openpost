import { createContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

export class UnsavedChangesContext {
	private sources = new SvelteMap<string, { message: string; discardable: boolean }>();

	get hasChanges(): boolean {
		return this.sources.size > 0;
	}

	get hasBlockingChanges(): boolean {
		for (const source of this.sources.values()) {
			if (!source.discardable) return true;
		}
		return false;
	}

	set(key: string, dirty: boolean, message: string, options: { discardable?: boolean } = {}): void {
		if (dirty) {
			this.sources.set(key, {
				message,
				discardable: options.discardable ?? true
			});
		} else this.sources.delete(key);
	}

	clear(key: string): void {
		this.sources.delete(key);
	}

	confirmDiscard(): boolean {
		if (!this.hasChanges) return true;
		let blockingSource: { message: string; discardable: boolean } | undefined;
		for (const source of this.sources.values()) {
			if (source.discardable) continue;
			blockingSource = source;
			break;
		}
		if (blockingSource) {
			window.alert(blockingSource.message);
			return false;
		}
		return window.confirm(
			this.sources.values().next().value?.message ?? 'Discard unsaved changes?'
		);
	}
}

export const [getUnsavedChanges, setUnsavedChanges] = createContext<UnsavedChangesContext>();

export function getOptionalUnsavedChanges(): UnsavedChangesContext | null {
	try {
		return getUnsavedChanges();
	} catch {
		return null;
	}
}
