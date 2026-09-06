import type { ThemeProtectedEditorTokens, ThemeScheme } from './contracts.js';

export const PROTECTED_EDITOR_TOKENS = {
	light: {
		editorCanvas: 'oklch(0.965 0.004 80)',
		editorPanel: 'oklch(0.985 0.003 85)',
		editorControl: 'oklch(0.925 0.006 75)',
		editorControlHover: 'oklch(0.89 0.008 70)',
		editorBorder: 'oklch(0.82 0.008 70)',
		editorMuted: 'oklch(0.43 0.015 55)',
		editorText: 'oklch(0.2 0.01 50)',
		editorFocus: 'oklch(0.55 0.155 45)',
		editorFocusBorder: 'oklch(0.47 0.11 45)',
		timelineTrack: 'oklch(0.93 0.005 75)',
		timelineClip: 'oklch(0.62 0.08 250)',
		timelineWaveform: 'oklch(0.3 0.05 245)',
		timelinePlayhead: 'oklch(0.55 0.155 45)',
		timelineSelection: 'oklch(0.86 0.045 45)',
		canvasPasteboard: 'oklch(0.9 0.006 75)',
		canvasGrid: 'oklch(0.72 0.01 65)',
		canvasHandle: 'oklch(0.2 0.01 50)',
		canvasSelection: 'oklch(0.55 0.155 45)',
		canvasSafeArea: 'oklch(0.43 0.08 245 / 0.72)',
		protectedGlyph: 'oklch(0.2 0.01 50)'
	},
	dark: {
		editorCanvas: 'oklch(0.12 0.006 55)',
		editorPanel: 'oklch(0.18 0.008 55)',
		editorControl: 'oklch(0.22 0.01 55)',
		editorControlHover: 'oklch(0.27 0.012 55)',
		editorBorder: 'oklch(0.29 0.01 55)',
		editorMuted: 'oklch(0.7 0.01 75)',
		editorText: 'oklch(0.94 0.004 85)',
		editorFocus: 'oklch(0.72 0.16 45)',
		editorFocusBorder: 'oklch(0.52 0.09 45)',
		timelineTrack: 'oklch(0.16 0.008 55)',
		timelineClip: 'oklch(0.3 0.04 250)',
		timelineWaveform: 'oklch(0.76 0.04 245)',
		timelinePlayhead: 'oklch(0.72 0.16 45)',
		timelineSelection: 'oklch(0.38 0.08 45)',
		canvasPasteboard: 'oklch(0.1 0.005 55)',
		canvasGrid: 'oklch(0.25 0.01 55)',
		canvasHandle: 'oklch(0.98 0 0)',
		canvasSelection: 'oklch(0.72 0.16 45)',
		canvasSafeArea: 'oklch(0.8 0.03 245 / 0.72)',
		protectedGlyph: 'oklch(0.94 0.004 85)'
	}
} satisfies Readonly<Record<ThemeScheme, ThemeProtectedEditorTokens>>;

export function protectedEditorTokens(scheme: ThemeScheme): ThemeProtectedEditorTokens {
	return structuredClone(PROTECTED_EDITOR_TOKENS[scheme]);
}
