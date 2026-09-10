import { browser } from '$app/environment';

type PublicationView = 'list' | 'calendar';
const storageKey = 'openpost-publication-view';

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
	get href() {
		return this.current === 'calendar' ? '/calendar' : '/publications';
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
