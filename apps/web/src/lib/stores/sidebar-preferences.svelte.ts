import { browser } from '$app/environment';

export type LandingPreference = 'home' | 'compose';

const draftsStorageKey = 'openpost-sidebar-drafts';
const landingStorageKey = 'openpost-landing';
const composerSessionKey = 'openpost-composer-open';

function saved(key: string): string | null {
	if (!browser) return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function save(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Keep the current session's choice when storage is blocked.
	}
}

class SidebarPreferences {
	draftsVisible = $state(saved(draftsStorageKey) === 'true');
	landing = $state<LandingPreference>(saved(landingStorageKey) === 'compose' ? 'compose' : 'home');
	#composerRequested = false;

	setDraftsVisible(visible: boolean) {
		this.draftsVisible = visible;
		save(draftsStorageKey, String(visible));
	}

	setLanding(landing: LandingPreference) {
		this.landing = landing;
		save(landingStorageKey, landing);
	}

	/** A creator's choice during onboarding sets both defaults at once. */
	applyWritingFirstDefaults() {
		this.setDraftsVisible(true);
		this.setLanding('compose');
	}

	requestComposer() {
		this.#composerRequested = true;
		try {
			sessionStorage.setItem(composerSessionKey, 'true');
		} catch {
			// The in-memory request still covers this navigation.
		}
	}

	/** `/` is both the app entry and the composer. Only entry follows the landing preference. */
	shouldOpenComposer(hasComposerParameters: boolean): boolean {
		if (hasComposerParameters || this.landing === 'compose' || this.#composerRequested) return true;
		try {
			return sessionStorage.getItem(composerSessionKey) === 'true';
		} catch {
			return false;
		}
	}

	leaveComposer() {
		this.#composerRequested = false;
		try {
			sessionStorage.removeItem(composerSessionKey);
		} catch {
			// Nothing persisted to clear.
		}
	}
}

export const sidebarPreferences = new SidebarPreferences();
