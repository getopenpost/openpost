import { browser } from '$app/environment';

type PublicationView = 'list' | 'calendar';
export type PublicationListTab = 'scheduled' | 'published' | 'failed' | 'drafts';
const storageKey = 'openpost-publication-view';
const listTabStorageKey = 'openpost-publication-list-tab';

export function isPublicationListTab(value: string | null): value is PublicationListTab {
	return value === 'scheduled' || value === 'published' || value === 'failed' || value === 'drafts';
}

function savedListTab(): PublicationListTab {
	if (!browser) return 'scheduled';
	try {
		const value = localStorage.getItem(listTabStorageKey);
		return isPublicationListTab(value) ? value : 'scheduled';
	} catch {
		return 'scheduled';
	}
}

function savedView(): PublicationView {
	if (!browser) return 'list';
	try {
		return localStorage.getItem(storageKey) === 'calendar' ? 'calendar' : 'list';
	} catch {
		return 'list';
	}
}

class PublicationViewPreference {
	current = $state<PublicationView>(savedView());
	listTab = $state<PublicationListTab>(savedListTab());
	get listHref() {
		return this.listTab === 'scheduled' ? '/publications' : `/publications?tab=${this.listTab}`;
	}
	get href() {
		return this.current === 'calendar' ? '/calendar' : this.listHref;
	}
	rememberListTab(tab: PublicationListTab) {
		this.listTab = tab;
		try {
			localStorage.setItem(listTabStorageKey, tab);
		} catch {
			// Keep the current session's selection when storage is blocked.
		}
	}
	remember(view: PublicationView) {
		this.current = view;
		try {
			localStorage.setItem(storageKey, view);
		} catch {
			// Navigation remains available when browser storage is blocked.
		}
	}
}

export const publicationView = new PublicationViewPreference();
