import {
	soundPreferences,
	type InterfaceSoundTheme,
	type InterfaceSoundToken
} from '$lib/stores/sound-preferences.svelte';

export function emitEditorSound(token: InterfaceSoundToken, previewIsPlaying: boolean): void {
	if (previewIsPlaying) return;
	soundPreferences.playSemantic(token);
}

export function previewEditorSound(theme: InterfaceSoundTheme): void {
	soundPreferences.playSemantic('confirm', theme);
}
