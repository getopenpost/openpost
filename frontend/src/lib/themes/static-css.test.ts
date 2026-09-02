import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveBuiltInTheme } from './builtins.js';
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
	it('defines the complete dark runtime variables before asynchronous theme resolution', () => {
		const expected = themeSchemeToCssVariables(resolveBuiltInTheme('workshop', 'dark'));
		const actual = declarations('.dark');

		expect([...actual.keys()].filter((key) => key.startsWith('--'))).toEqual(
			expect.arrayContaining(Object.keys(expected))
		);
		for (const [property, value] of Object.entries(expected)) {
			expect(normalized(actual.get(property) ?? ''), property).toBe(normalized(value));
		}
	});

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
});
