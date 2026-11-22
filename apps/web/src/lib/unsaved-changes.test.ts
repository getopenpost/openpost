import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesContext } from './unsaved-changes.svelte';

describe('UnsavedChangesContext', () => {
	beforeEach(() => {
		vi.stubGlobal('window', {
			confirm: vi.fn(() => true),
			alert: vi.fn(() => undefined)
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

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

	it('blocks discard while a non-discardable operation is running', () => {
		const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
		const confirm = vi.spyOn(window, 'confirm');
		const changes = new UnsavedChangesContext();
		changes.set('token', true, 'Wait for token creation.', {
			discardable: false
		});

		expect(changes.hasBlockingChanges).toBe(true);
		expect(changes.confirmDiscard()).toBe(false);
		expect(alert).toHaveBeenCalledWith('Wait for token creation.');
		expect(confirm).not.toHaveBeenCalled();
	});

	it('delegates workspace changes to their owner while retaining navigation protection', () => {
		const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
		const changes = new UnsavedChangesContext();
		changes.set('composer', true, 'Unsaved post changes', { guardWorkspaceSwitch: false });

		expect(changes.confirmDiscard('workspace-switch')).toBe(true);
		expect(confirm).not.toHaveBeenCalled();
		expect(changes.confirmDiscard()).toBe(false);
		expect(confirm).toHaveBeenLastCalledWith('Unsaved post changes');

		changes.set('settings', true, 'Unsaved settings');
		expect(changes.confirmDiscard('workspace-switch')).toBe(false);
		expect(confirm).toHaveBeenLastCalledWith('Unsaved settings');
	});
});
