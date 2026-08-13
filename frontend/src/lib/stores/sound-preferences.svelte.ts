import { browser } from '$app/environment';
import {
	bind as bindCuelume,
	play as playCue,
	setEnabled as setCuelumeEnabled,
	type SoundName
} from 'cuelume';

const STORAGE_KEY = 'openpost:interface-sounds';

class SoundPreferences {
	enabled = $state(true);
	initialized = $state(false);

	initialize() {
		if (!browser || this.initialized) return;

		try {
			this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
		} catch {
			this.enabled = true;
		}

		setCuelumeEnabled(this.enabled);
		bindCuelume(document);
		this.initialized = true;
	}

	setEnabled(nextEnabled: boolean) {
		if (!browser) return;
		if (!this.initialized) this.initialize();

		this.enabled = nextEnabled;
		setCuelumeEnabled(nextEnabled);

		try {
			localStorage.setItem(STORAGE_KEY, nextEnabled ? 'on' : 'off');
		} catch {
			// The in-memory preference still works when storage is unavailable.
		}

		if (nextEnabled) playCue('toggle');
	}

	play(cue: SoundName) {
		if (!browser) return;
		if (!this.initialized) this.initialize();
		if (!this.enabled) return;
		playCue(cue);
	}
}

export const soundPreferences = new SoundPreferences();
