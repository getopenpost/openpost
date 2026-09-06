import {
	soundPreferences,
	type InterfaceSoundTheme,
	type InterfaceSoundToken
} from '$lib/stores/sound-preferences.svelte';

interface EditorSoundPreferences {
	playSemantic(token: InterfaceSoundToken, previewTheme?: InterfaceSoundTheme): void;
}

export function emitEditorSound(
	token: InterfaceSoundToken,
	previewIsPlaying: boolean,
	preferences: EditorSoundPreferences = soundPreferences
): void {
	if (previewIsPlaying) return;
	preferences.playSemantic(token);
}

export function previewEditorSound(
	theme: InterfaceSoundTheme,
	preferences: EditorSoundPreferences = soundPreferences
): void {
	preferences.playSemantic('confirm', theme);
}
