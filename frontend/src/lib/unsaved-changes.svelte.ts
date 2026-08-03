import { createContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

export class UnsavedChangesContext {
	private sources = new SvelteMap<string, string>();

	get hasChanges(): boolean {
		return this.sources.size > 0;
	}

	set(key: string, dirty: boolean, message: string): void {
		if (dirty) this.sources.set(key, message);
		else this.sources.delete(key);
	}

	clear(key: string): void {
		this.sources.delete(key);
	}

	confirmDiscard(): boolean {
		if (!this.hasChanges) return true;
		return window.confirm(this.sources.values().next().value ?? 'Discard unsaved changes?');
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
