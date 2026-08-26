import { writable, derived } from 'svelte/store';

const hoveredStore = writable(false);
const focusedStore = writable(false);

let hoveredValue = false;
let focusedValue = false;
hoveredStore.subscribe((value) => {
	hoveredValue = value;
});
focusedStore.subscribe((value) => {
	focusedValue = value;
});

export const sourceHoverStore = {
	get isHovered(): boolean {
		return hoveredValue;
	},
	get isFocused(): boolean {
		return focusedValue;
	},
	get isActive(): boolean {
		return hoveredValue || focusedValue;
	},
	setHovered(value: boolean): void {
		hoveredStore.set(value);
	},
	setFocused(value: boolean): void {
		focusedStore.set(value);
	},
	// Exposed for Svelte derived usage if needed
	_hoveredStore: hoveredStore,
	_focusedStore: focusedStore,
	active: derived([hoveredStore, focusedStore], ([hovered, focused]) => hovered || focused)
};
