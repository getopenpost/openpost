import { browser } from '$app/environment';
import {
	bind as bindCuelume,
	play as playCue,
	setEnabled as setCuelumeEnabled,
	setVolume as setCuelumeVolume,
	type SoundName
} from 'cuelume';
import { z } from 'zod';
const STORAGE_KEY = 'openpost:interface-sounds';

export const INTERFACE_SOUND_THEMES = ['signature', 'velvet', 'crisp'] as const;
export type InterfaceSoundTheme = (typeof INTERFACE_SOUND_THEMES)[number];
export type InterfaceSoundToken =
	| 'select'
	| 'confirm'
	| 'cancel'
	| 'toggleOn'
	| 'toggleOff'
	| 'delete'
	| 'error';

export interface InterfaceSoundSettings {
	enabled: boolean;
	volume: number;
	theme: InterfaceSoundTheme;
}

export const DEFAULT_INTERFACE_SOUND_SETTINGS: InterfaceSoundSettings = {
	enabled: true,
	volume: 0.6,
	theme: 'signature'
};

const storedSettingsSchema = z.object({
	version: z.literal(1).optional(),
	enabled: z.boolean(),
	volume: z.number(),
	theme: z.enum(INTERFACE_SOUND_THEMES)
});

const THEME_CUES = {
	signature: {
		select: 'tick',
		confirm: 'success',
		cancel: 'droplet',
		toggleOn: 'toggle',
		toggleOff: 'toggle',
		delete: 'droplet',
		error: 'error'
	},
	velvet: {
		select: 'whisper',
		confirm: 'bloom',
		cancel: 'whisper',
		toggleOn: 'bloom',
		toggleOff: 'droplet',
		delete: 'droplet',
		error: 'error'
	},
	crisp: {
		select: 'tick',
		confirm: 'ready',
		cancel: 'release',
		toggleOn: 'pulse',
		toggleOff: 'press',
		delete: 'press',
		error: 'error'
	}
} satisfies Record<InterfaceSoundTheme, Record<InterfaceSoundToken, SoundName>>;

interface SoundStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

interface SoundEngine {
	bind(root?: ParentNode): void;
	play(name: SoundName): void;
	setEnabled(enabled: boolean): void;
	setVolume(volume: number): void;
}

const cuelumeEngine: SoundEngine = {
	bind: bindCuelume,
	play: playCue,
	setEnabled: setCuelumeEnabled,
	setVolume: setCuelumeVolume
};

function browserStorage(): SoundStorage | null {
	if (!browser) return null;
	try {
		return localStorage;
	} catch {
		return null;
	}
}

function clampVolume(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_INTERFACE_SOUND_SETTINGS.volume;
	return Math.min(1, Math.max(0, value));
}

export function parseInterfaceSoundSettings(value: string | null): InterfaceSoundSettings {
	if (value === 'on' || value === 'off') {
		return { ...DEFAULT_INTERFACE_SOUND_SETTINGS, enabled: value === 'on' };
	}
	if (!value) return { ...DEFAULT_INTERFACE_SOUND_SETTINGS };
	try {
		const parsed = storedSettingsSchema.safeParse(JSON.parse(value));
		if (!parsed.success) return { ...DEFAULT_INTERFACE_SOUND_SETTINGS };
		return {
			enabled: parsed.data.enabled,
			volume: clampVolume(parsed.data.volume),
			theme: parsed.data.theme
		};
	} catch {
		return { ...DEFAULT_INTERFACE_SOUND_SETTINGS };
	}
}

export function interfaceSoundCue(
	token: InterfaceSoundToken,
	theme: InterfaceSoundTheme
): SoundName {
	return THEME_CUES[theme][token];
}

export function createSoundPreferences(
	storage: SoundStorage | null = browserStorage(),
	engine: SoundEngine = cuelumeEngine
) {
	let enabled = $state(DEFAULT_INTERFACE_SOUND_SETTINGS.enabled);
	let volume = $state(DEFAULT_INTERFACE_SOUND_SETTINGS.volume);
	let theme = $state<InterfaceSoundTheme>(DEFAULT_INTERFACE_SOUND_SETTINGS.theme);
	let initialized = $state(false);

	function persist(): void {
		try {
			storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, enabled, volume, theme }));
		} catch {
			// The in-memory preference still works when storage is unavailable.
		}
	}

	function initialize(root?: ParentNode): void {
		if (!browser || initialized) return;
		let storedValue: string | null = null;
		try {
			storedValue = storage?.getItem(STORAGE_KEY) ?? null;
		} catch {
			storedValue = null;
		}
		const saved = parseInterfaceSoundSettings(storedValue);
		enabled = saved.enabled;
		volume = saved.volume;
		theme = saved.theme;
		engine.setVolume(volume);
		engine.setEnabled(enabled);
		engine.bind(root ?? document);
		initialized = true;
	}

	function ensureInitialized(): boolean {
		if (!browser) return false;
		if (!initialized) initialize();
		return initialized;
	}

	return {
		get enabled(): boolean {
			return enabled;
		},
		get volume(): number {
			return volume;
		},
		get theme(): InterfaceSoundTheme {
			return theme;
		},
		get initialized(): boolean {
			return initialized;
		},
		initialize,
		setEnabled(nextEnabled: boolean): void {
			if (!ensureInitialized() || nextEnabled === enabled) return;
			if (nextEnabled) {
				enabled = true;
				engine.setEnabled(true);
				persist();
				engine.play(interfaceSoundCue('toggleOn', theme));
				return;
			}
			engine.play(interfaceSoundCue('toggleOff', theme));
			enabled = false;
			persist();
			engine.setEnabled(false);
		},
		setVolume(nextVolume: number): void {
			if (!ensureInitialized()) return;
			volume = clampVolume(nextVolume);
			engine.setVolume(volume);
			persist();
		},
		setTheme(nextTheme: InterfaceSoundTheme): void {
			if (!ensureInitialized() || nextTheme === theme) return;
			theme = nextTheme;
			persist();
		},
		play(cue: SoundName): void {
			if (!ensureInitialized() || !enabled || volume <= 0) return;
			engine.play(cue);
		},
		playSemantic(token: InterfaceSoundToken, previewTheme?: InterfaceSoundTheme): void {
			if (!ensureInitialized() || !enabled || volume <= 0) return;
			engine.play(interfaceSoundCue(token, previewTheme ?? theme));
		},
		reset(): void {
			if (!ensureInitialized()) return;
			enabled = DEFAULT_INTERFACE_SOUND_SETTINGS.enabled;
			volume = DEFAULT_INTERFACE_SOUND_SETTINGS.volume;
			theme = DEFAULT_INTERFACE_SOUND_SETTINGS.theme;
			engine.setVolume(volume);
			engine.setEnabled(enabled);
			persist();
		}
	};
}

export const soundPreferences = createSoundPreferences();
