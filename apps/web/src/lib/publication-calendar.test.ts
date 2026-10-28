// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
	publicationActivityOccurrence,
	publicationCalendarDayKey,
	publicationCalendarOccurrence
} from './publication-calendar';

describe('publication occurrence selection', () => {
	it('shows the authored schedule for a scheduled post with a jittered dispatch time', () => {
		const publication = {
			status: 'scheduled',
			scheduled_at: '2026-10-18T10:00:00Z',
			actual_run_at: '2026-10-18T10:07:00Z',
			updated_at: '2026-10-18T09:00:00Z',
			created_at: '2026-10-18T08:00:00Z'
		};
		expect(publicationCalendarOccurrence(publication)).toBe('2026-10-18T10:00:00Z');
		expect(publicationActivityOccurrence(publication)).toBe('2026-10-18T10:00:00Z');
	});

	it('shows the authored schedule for a publishing post', () => {
		const publication = {
			status: 'publishing',
			scheduled_at: '2026-10-18T10:00:00Z',
			actual_run_at: '2026-10-18T10:07:00Z',
			created_at: '2026-10-18T08:00:00Z'
		};
		expect(publicationCalendarOccurrence(publication)).toBe('2026-10-18T10:00:00Z');
		expect(publicationActivityOccurrence(publication)).toBe('2026-10-18T10:00:00Z');
	});

	it('shows the queued time, not the previous run, for a retried post without an authored schedule', () => {
		const retried = {
			status: 'scheduled',
			actual_run_at: '2026-07-20T08:00:00Z',
			updated_at: '2026-10-18T08:53:08Z',
			created_at: '2026-07-20T07:00:00Z'
		};
		expect(publicationCalendarOccurrence(retried)).toBeNull();
		expect(publicationActivityOccurrence(retried)).toBe('2026-10-18T08:53:08Z');
	});

	describe.each([
		{
			status: 'draft',
			publication: {
				status: 'draft',
				scheduled_at: '2026-10-18T10:00:00Z',
				created_at: '2026-10-18T08:00:00Z'
			},
			occurrence: null,
			activity: '2026-10-18T10:00:00Z'
		},
		{
			status: 'ready without a schedule',
			publication: { status: 'ready', created_at: '2026-10-18T08:00:00Z' },
			occurrence: null,
			activity: '2026-10-18T08:00:00Z'
		},
		{
			status: 'ready with a schedule',
			publication: {
				status: 'ready',
				scheduled_at: '2026-10-18T10:00:00Z',
				created_at: '2026-10-18T08:00:00Z'
			},
			occurrence: null,
			activity: '2026-10-18T10:00:00Z'
		},
		{
			status: 'scheduled',
			publication: {
				status: 'scheduled',
				scheduled_at: '2026-10-18T10:00:00Z',
				created_at: '2026-10-18T08:00:00Z'
			},
			occurrence: '2026-10-18T10:00:00Z',
			activity: '2026-10-18T10:00:00Z'
		},
		{
			status: 'publishing',
			publication: {
				status: 'publishing',
				scheduled_at: '2026-10-18T10:00:00Z',
				created_at: '2026-10-18T08:00:00Z'
			},
			occurrence: '2026-10-18T10:00:00Z',
			activity: '2026-10-18T10:00:00Z'
		},
		{
			status: 'published',
			publication: {
				status: 'published',
				scheduled_at: '2026-10-18T10:00:00Z',
				actual_run_at: '2026-10-18T10:07:00Z',
				created_at: '2026-10-18T08:00:00Z'
			},
			occurrence: '2026-10-18T10:07:00Z',
			activity: '2026-10-18T10:07:00Z'
		},
		{
			status: 'failed with a schedule',
			publication: {
				status: 'failed',
				scheduled_at: '2026-10-18T10:00:00Z',
				created_at: '2026-10-18T08:00:00Z'
			},
			occurrence: null,
			activity: '2026-10-18T10:00:00Z'
		}
	])('status $status', ({ publication, occurrence, activity }) => {
		it('maps the calendar occurrence', () => {
			expect(publicationCalendarOccurrence(publication)).toBe(occurrence);
		});

		it('maps the activity occurrence', () => {
			expect(publicationActivityOccurrence(publication)).toBe(activity);
		});
	});
});

describe('publicationCalendarDayKey', () => {
	it('places a scheduled post on its authored day', () => {
		expect(
			publicationCalendarDayKey(
				{
					status: 'scheduled',
					scheduled_at: '2026-10-18T10:00:00Z',
					actual_run_at: '2026-10-18T10:07:00Z',
					created_at: '2026-10-18T08:00:00Z'
				},
				'UTC'
			)
		).toBe('2026-10-18');
	});

	it('places a published post on its recorded run day', () => {
		expect(
			publicationCalendarDayKey(
				{
					status: 'published',
					scheduled_at: '2026-10-18T10:00:00Z',
					actual_run_at: '2026-10-19T00:07:00Z',
					created_at: '2026-10-18T08:00:00Z'
				},
				'UTC'
			)
		).toBe('2026-10-19');
	});

	it('returns no day for statuses without an occurrence', () => {
		expect(
			publicationCalendarDayKey(
				{
					status: 'ready',
					scheduled_at: '2026-10-18T10:00:00Z',
					created_at: '2026-10-18T08:00:00Z'
				},
				'UTC'
			)
		).toBe('');
	});
});
