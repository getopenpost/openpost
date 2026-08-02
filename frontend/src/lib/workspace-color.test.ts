import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE_COLOR, workspaceColor } from './workspace-color';

describe('workspaceColor', () => {
	it('uses the saved workspace color and rejects malformed legacy values', () => {
		expect(workspaceColor({ id: 'workspace-1', color: '#2563EB' })).toBe('#2563eb');
		expect(workspaceColor({ id: 'workspace-1', color: 'red' })).toBe(DEFAULT_WORKSPACE_COLOR);
		expect(workspaceColor({ id: 'workspace-1' })).toBe(DEFAULT_WORKSPACE_COLOR);
	});
});
