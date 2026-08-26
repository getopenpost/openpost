let hovered = $state(false);
let focused = $state(false);

export const sourceHoverStore = {
	get isHovered(): boolean {
		return hovered;
	},
	get isFocused(): boolean {
		return focused;
	},
	get isActive(): boolean {
		return hovered || focused;
	},
	setHovered(value: boolean): void {
		hovered = value;
	},
	setFocused(value: boolean): void {
		focused = value;
	}
};
