import { describe, expect, it } from 'vitest';
import { THEME_COLOR_TOKEN_KEYS, THEME_COMPONENT_RECIPE_KEYS } from '$lib/themes';
import { themeColorGroups, themeComponentGroups } from './theme-editor-fields';

function flattenedFields(groups: readonly { fields: readonly string[] }[]) {
	return groups.flatMap((group) => group.fields);
}

describe('theme editor field groups', () => {
	it('exposes every color token exactly once', () => {
		const fields = flattenedFields(themeColorGroups('en'));
		expect(new Set(fields).size).toBe(fields.length);
		expect([...fields].sort()).toEqual([...THEME_COLOR_TOKEN_KEYS].sort());
	});

	it('exposes every component recipe exactly once', () => {
		const fields = flattenedFields(themeComponentGroups('en'));
		expect(new Set(fields).size).toBe(fields.length);
		expect([...fields].sort()).toEqual([...THEME_COMPONENT_RECIPE_KEYS].sort());
	});

	it('resolves labels for the requested locale on every call', () => {
		expect(themeColorGroups('en')[0]?.label).toBe('Foundation');
		expect(themeColorGroups('de')[0]?.label).not.toBe('Foundation');
		expect(themeComponentGroups('pt')[0]?.description).not.toBe(
			'Buttons, links, tabs, and navigation.'
		);
	});
});
