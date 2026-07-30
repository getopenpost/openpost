import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./composer-schedule-dialog.svelte', import.meta.url), 'utf8');

function classesFor(testId: string) {
	const element = source.match(new RegExp(`<[^>]+data-testid=["']${testId}["'][^>]*>`, 's'))?.[0];
	const className = element?.match(/class=["']([^"']+)["']/s)?.[1];

	expect(element, `missing ${testId}`).toBeDefined();
	expect(className, `missing classes on ${testId}`).toBeDefined();
	return className?.split(/\s+/) ?? [];
}

describe('schedule dialog mobile layout', () => {
	it('keeps the shell in the dynamic viewport and gives scrolling to the body only', () => {
		const shellClasses = classesFor('schedule-dialog-shell');
		const bodyClasses = classesFor('schedule-dialog-body');
		const timeListClasses = classesFor('schedule-dialog-time-list');

		expect(shellClasses).toEqual(
			expect.arrayContaining(['flex', 'max-h-[calc(100dvh-1rem)]', 'overflow-hidden'])
		);
		expect(shellClasses).not.toContain('overflow-y-auto');
		expect(bodyClasses).toEqual(expect.arrayContaining(['min-h-0', 'flex-1', 'overflow-y-auto']));
		expect(timeListClasses).toEqual(
			expect.arrayContaining(['md:min-h-0', 'md:flex-1', 'md:overflow-hidden'])
		);
		expect(timeListClasses).not.toContain('max-h-72');
		expect(timeListClasses).not.toContain('overflow-y-auto');
	});

	it('shows two paged months at the desktop breakpoint', () => {
		expect(source).toContain("new MediaQuery('min-width: 768px')");
		expect(source).toContain('sm:max-w-4xl');
		expect(source).toContain('numberOfMonths={desktopCalendar.current ? 2 : 1}');
		expect(source).toContain('pagedNavigation={desktopCalendar.current}');
		expect(source).toContain('<ScrollArea type="auto" class="h-full"');
	});
});
