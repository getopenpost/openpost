import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveBuiltInTheme } from './builtins.js';
import { THEME_CANVAS_TREATMENTS, THEME_COMPONENT_RECIPE_OPTIONS } from './contracts.js';
import { themeSchemeToCssVariables } from './runtime.js';

function declarations(selector: string): Map<string, string> {
	const css = readFileSync(new URL('../../routes/layout.css', import.meta.url), 'utf8');
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const block = new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? '';
	return new Map(
		[...block.matchAll(/\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((match) => [match[1], match[2]])
	);
}

function layoutCss(): string {
	return readFileSync(new URL('../../routes/layout.css', import.meta.url), 'utf8');
}

function normalized(value: string): string {
	return value.replaceAll(/['"]/g, '').replaceAll(/\s+/g, ' ').trim();
}

describe('embedded Workshop CSS', () => {
	it.each([
		['light', ':root'],
		['dark', '.dark']
	] as const)(
		'defines the complete %s runtime variables before asynchronous theme resolution',
		(scheme, selector) => {
			const expected = themeSchemeToCssVariables(resolveBuiltInTheme('workshop', scheme));
			const actual = declarations(selector);

			expect([...actual.keys()].filter((key) => key.startsWith('--'))).toEqual(
				expect.arrayContaining(Object.keys(expected))
			);
			for (const [property, value] of Object.entries(expected)) {
				expect(normalized(actual.get(property) ?? ''), property).toBe(normalized(value));
			}
		}
	);

	it('activates theme reduced-motion recipes only for an operating-system preference', () => {
		const css = layoutCss();
		const mediaStart = css.indexOf('@media (prefers-reduced-motion: reduce)');
		expect(mediaStart).toBeGreaterThanOrEqual(0);
		const beforeMedia = css.slice(0, mediaStart);
		const reducedMotionRules = css.slice(mediaStart, css.indexOf('@media (pointer: coarse)'));

		expect(beforeMedia).not.toContain("[data-theme-reduced-motion='instant']");
		expect(beforeMedia).not.toContain("[data-theme-reduced-motion='crossfade']");
		expect(reducedMotionRules).toContain("[data-theme-reduced-motion='instant']");
		expect(reducedMotionRules).toContain("[data-theme-reduced-motion='crossfade']");
		expect(reducedMotionRules).toContain('--theme-motion-entry-distance: 0px');
		expect(reducedMotionRules).toContain('transition-duration: 120ms !important');
	});

	it('implements every declared canvas and component recipe as a CSS hook', () => {
		const css = layoutCss();
		for (const treatment of THEME_CANVAS_TREATMENTS) {
			expect(css, `canvas ${treatment}`).toContain(`[data-theme-canvas='${treatment}']`);
		}
		for (const [recipe, options] of Object.entries(THEME_COMPONENT_RECIPE_OPTIONS)) {
			for (const option of options) {
				expect(css, `${recipe} ${option}`).toContain(
					`[data-theme-${recipe.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}='${option}']`
				);
			}
		}
	});
});
