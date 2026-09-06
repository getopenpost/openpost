import { describe, expect, it } from 'vitest';
import { publicationCalendarOccurrence, type CalendarPublication } from './publication-calendar';

function publication(overrides: Partial<CalendarPublication>): CalendarPublication {
	return {
		status: 'draft',
		updated_at: '2026-07-26T12:00:00Z',
		created_at: '2026-07-25T12:00:00Z',
		...overrides
	};
}

describe('publication calendar occurrence', () => {
	it('uses the proposed time for scheduled publications', () => {
		expect(
			publicationCalendarOccurrence(
				publication({ status: 'scheduled', scheduled_at: '2026-08-01T09:00:00Z' })
			)
		).toBe('2026-08-01T09:00:00Z');
	});

	it('keeps a publishing publication on its scheduled day', () => {
		expect(
			publicationCalendarOccurrence(
				publication({ status: 'publishing', scheduled_at: '2026-08-01T09:00:00Z' })
			)
		).toBe('2026-08-01T09:00:00Z');
	});

	it('uses the actual run time for published publications', () => {
		expect(
			publicationCalendarOccurrence(
				publication({
					status: 'published',
					actual_run_at: '2026-07-27T09:05:00Z',
					scheduled_at: '2026-07-27T09:00:00Z'
				})
			)
		).toBe('2026-07-27T09:05:00Z');
	});

	it('falls back through historical publication timestamps', () => {
		expect(
			publicationCalendarOccurrence(
				publication({
					status: 'published',
					scheduled_at: '2026-07-24T09:00:00Z'
				})
			)
		).toBe('2026-07-24T09:00:00Z');
		expect(publicationCalendarOccurrence(publication({ status: 'published' }))).toBe(
			'2026-07-26T12:00:00Z'
		);
	});

	it('keeps drafts and failed publications out of the calendar', () => {
		expect(publicationCalendarOccurrence(publication({ status: 'draft' }))).toBeNull();
		expect(publicationCalendarOccurrence(publication({ status: 'failed' }))).toBeNull();
	});
});
