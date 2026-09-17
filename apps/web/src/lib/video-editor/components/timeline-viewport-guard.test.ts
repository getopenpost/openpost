import { describe, expect, it } from 'vitest';
import {
	applyTimelineVisibilityEntries,
	hasTimelineViewportChanged
} from './timeline-panel.svelte';

describe('hasTimelineViewportChanged', () => {
	it('ignores vertical-only scrolls so downstream recompute is skipped', () => {
		const previous = { scrollLeft: 120, width: 800 };
		expect(hasTimelineViewportChanged(previous, 120, 800)).toBe(false);
		expect(hasTimelineViewportChanged(previous, 121, 800)).toBe(true);
		expect(hasTimelineViewportChanged(previous, 120, 799)).toBe(true);
		expect(hasTimelineViewportChanged(previous, 0, 0)).toBe(true);
	});
});

describe('applyTimelineVisibilityEntries', () => {
	it('returns null when no membership changes so effects are skipped', () => {
		const previous = new Set(['a', 'b']);
		expect(applyTimelineVisibilityEntries(previous, [])).toBeNull();
		expect(
			applyTimelineVisibilityEntries(previous, [
				{ id: 'a', isIntersecting: true },
				{ id: 'b', isIntersecting: true }
			])
		).toBeNull();
		// Duplicate reports for an already-absent id change nothing.
		expect(
			applyTimelineVisibilityEntries(previous, [{ id: 'c', isIntersecting: false }])
		).toBeNull();
	});

	it('returns a new set only for real membership changes', () => {
		const previous = new Set(['a', 'b']);
		const next = applyTimelineVisibilityEntries(previous, [
			{ id: 'b', isIntersecting: false },
			{ id: 'c', isIntersecting: true }
		]);
		expect(next).not.toBeNull();
		expect([...next!].sort()).toEqual(['a', 'c']);
		// The previous set is never mutated.
		expect([...previous].sort()).toEqual(['a', 'b']);
	});
});
