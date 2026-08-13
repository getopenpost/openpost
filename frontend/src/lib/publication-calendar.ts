export interface CalendarPublication {
	status: string;
	scheduled_at?: string;
	actual_run_at?: string;
	updated_at: string;
	created_at: string;
}

export function publicationCalendarOccurrence(publication: CalendarPublication): string | null {
	if (publication.status === 'scheduled' || publication.status === 'publishing') {
		return publication.scheduled_at || null;
	}
	if (publication.status === 'published') {
		return (
			publication.actual_run_at ||
			publication.scheduled_at ||
			publication.updated_at ||
			publication.created_at ||
			null
		);
	}
	return null;
}
