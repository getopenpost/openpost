import { describe, expect, it, vi } from 'vitest';
import { UnsavedChangesContext } from './unsaved-changes.svelte';

describe('UnsavedChangesContext', () => {
	it('keeps navigation clear until a registered form is dirty', () => {
		const changes = new UnsavedChangesContext();
		expect(changes.hasChanges).toBe(false);

		changes.set('workspace', true, 'Leave without saving?');
		expect(changes.hasChanges).toBe(true);

		changes.clear('workspace');
		expect(changes.hasChanges).toBe(false);
	});

	it('uses the registered recovery copy before discarding changes', () => {
		const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
		const changes = new UnsavedChangesContext();
		changes.set('workspace', true, 'Leave without saving?');

		expect(changes.confirmDiscard()).toBe(false);
		expect(confirm).toHaveBeenCalledWith('Leave without saving?');
	});
});
