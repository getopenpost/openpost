import { describe, expect, it } from 'vitest';
import {
	createSoundPreferences,
	interfaceSoundCue,
	parseInterfaceSoundSettings
} from './sound-preferences.svelte';

function memoryStorage(initial: string | null = null) {
	let value = initial;
	return {
		getItem: () => value,
		setItem: (_key: string, next: string) => (value = next),
		value: () => value
	};
}

function recordingEngine() {
	const events: string[] = [];
	return {
		events,
		bind: () => events.push('bind'),
		play: (name: string, options?: { theme?: string }) =>
			events.push(`play:${name}${options?.theme ? `@${options.theme}` : ''}`),
		setEnabled: (enabled: boolean) => events.push(`enabled:${enabled}`),
		setTheme: (theme: string) => events.push(`theme:${theme}`),
		setVolume: (volume: number) => events.push(`volume:${volume}`)
	};
}

describe('interface sound preferences', () => {
	it('starts enabled, persists volume and theme, and emits one cue per state change', () => {
		const storage = memoryStorage();
		const engine = recordingEngine();
		const sounds = createSoundPreferences(storage, engine);
		sounds.initialize(document);

		expect(sounds.enabled).toBe(true);
		expect(sounds.volume).toBe(0.6);
		expect(engine.events).toEqual(['volume:0.6', 'enabled:true', 'theme:default', 'bind']);

		sounds.setEnabled(false);
		sounds.setEnabled(false);
		sounds.setEnabled(true);
		sounds.setVolume(2);
		sounds.setTheme('crisp');
		sounds.playSemantic('confirm');
		expect(engine.events.filter((event) => event.startsWith('play:'))).toEqual([
			'play:toggle@default',
			'play:toggle@default',
			'play:success@mech'
		]);
		expect(JSON.parse(storage.value() ?? '{}')).toEqual({
			version: 1,
			enabled: true,
			volume: 1,
			theme: 'crisp'
		});

		sounds.setEnabled(false);
		sounds.playSemantic('delete');
		expect(engine.events.at(-2)).toBe('play:toggle@mech');
		expect(engine.events.at(-1)).toBe('enabled:false');
	});

	it('migrates the old on/off value and rejects corrupt settings', () => {
		expect(parseInterfaceSoundSettings('on')).toEqual({
			enabled: true,
			volume: 0.6,
			theme: 'signature'
		});
		expect(parseInterfaceSoundSettings('{broken')).toEqual({
			enabled: true,
			volume: 0.6,
			theme: 'signature'
		});
		expect(interfaceSoundCue('confirm', 'velvet')).toEqual({
			name: 'success',
			options: { theme: 'press' }
		});

		const engine = recordingEngine();
		const blockedStorage = {
			getItem(): string | null {
				throw new Error('blocked');
			},
			setItem(): void {
				throw new Error('blocked');
			}
		};
		const sounds = createSoundPreferences(blockedStorage, engine);
		expect(() => sounds.initialize(document)).not.toThrow();
		sounds.setEnabled(true);
		expect(sounds.enabled).toBe(true);
	});
});
