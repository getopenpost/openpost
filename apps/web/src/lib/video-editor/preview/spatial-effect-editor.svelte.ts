let editingItemId = $state<string | null>(null);
let editingEffectId = $state<string | null>(null);

export const spatialEffectEditorStore = {
	get isEditing(): boolean {
		return editingItemId !== null && editingEffectId !== null;
	},
	get editingItemId(): string | null {
		return editingItemId;
	},
	get editingEffectId(): string | null {
		return editingEffectId;
	},
	startEditing(itemId: string, effectId: string): void {
		editingItemId = itemId;
		editingEffectId = effectId;
	},
	stopEditing(): void {
		editingItemId = null;
		editingEffectId = null;
	},
	__resetForTesting(): void {
		editingItemId = null;
		editingEffectId = null;
	}
};
