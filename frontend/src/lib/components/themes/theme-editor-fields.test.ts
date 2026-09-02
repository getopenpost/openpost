import { describe, expect, it } from 'vitest';
import { THEME_COLOR_TOKEN_KEYS, THEME_COMPONENT_RECIPE_KEYS } from '$lib/themes';
import { THEME_COLOR_GROUPS, THEME_COMPONENT_GROUPS } from './theme-editor-fields';

function flattenedFields(groups: readonly { fields: readonly string[] }[]) {
	return groups.flatMap((group) => group.fields);
}

describe('theme editor field groups', () => {
	it('exposes every color token exactly once', () => {
		const fields = flattenedFields(THEME_COLOR_GROUPS);
		expect(new Set(fields).size).toBe(fields.length);
		expect([...fields].sort()).toEqual([...THEME_COLOR_TOKEN_KEYS].sort());
	});

	it('exposes every component recipe exactly once', () => {
		const fields = flattenedFields(THEME_COMPONENT_GROUPS);
		expect(new Set(fields).size).toBe(fields.length);
		expect([...fields].sort()).toEqual([...THEME_COMPONENT_RECIPE_KEYS].sort());
	});
});
