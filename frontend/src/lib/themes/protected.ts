import type { ThemeProtectedEditorTokens, ThemeScheme } from './contracts.js';

export const PROTECTED_EDITOR_TOKENS = {
	light: {
		editorCanvas: 'oklch(0.15 0.006 55)',
		editorPanel: 'oklch(0.2 0.008 55)',
		editorControl: 'oklch(0.24 0.01 55)',
		editorControlHover: 'oklch(0.29 0.012 55)',
		editorBorder: 'oklch(0.32 0.01 55)',
		editorMuted: 'oklch(0.7 0.01 75)',
		editorText: 'oklch(0.94 0.004 85)',
		editorFocus: 'oklch(0.65 0.15 45)',
		editorFocusBorder: 'oklch(0.5 0.09 45)',
		timelineTrack: 'oklch(0.18 0.008 55)',
		timelineClip: 'oklch(0.31 0.04 250)',
		timelineWaveform: 'oklch(0.74 0.04 245)',
		timelinePlayhead: 'oklch(0.65 0.15 45)',
		timelineSelection: 'oklch(0.36 0.07 45)',
		canvasPasteboard: 'oklch(0.12 0.006 55)',
		canvasGrid: 'oklch(0.28 0.01 55)',
		canvasHandle: 'oklch(0.98 0 0)',
		canvasSelection: 'oklch(0.65 0.15 45)',
		canvasSafeArea: 'oklch(0.78 0.03 245 / 0.72)',
		protectedGlyph: 'oklch(0.94 0.004 85)'
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
