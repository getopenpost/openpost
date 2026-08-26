/**
 * Cursor sidecar for screen recording.
 *
 * Browser display capture cannot expose desktop cursor coordinates as
 * telemetry. The cursor can only be burned into the captured video track
 * where the browser supports it. Editable cursor metadata requires native
 * capture; this module records honest settings and never claims preview
 * pointer positions are desktop cursor data.
 */

export interface CursorSidecar {
	version: 1;
	mode: 'burned-in' | 'hidden';
	editable: false;
	reason: string;
}

export function createCursorSidecar(burnedIn: boolean): CursorSidecar {
	return {
		version: 1,
		mode: burnedIn ? 'burned-in' : 'hidden',
		editable: false,
		reason: burnedIn
			? 'cursor-burned-into-video-track'
			: 'browser-display-capture-no-telemetry-editable-cursor-requires-native-capture'
	};
}

// SAFETY: storage boundary, validated field-by-field
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- storage boundary parser

export function validateCursorSidecar(value: unknown): CursorSidecar | null {
	// SAFETY: storage boundary, object check at JSON boundary
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- storage boundary object check
	if (typeof value !== 'object' || value === null) return null;
	// SAFETY: validated via field checks below
	// SAFETY: validated via field checks below
	const candidate = value as Record<string, unknown>;
	if (candidate.version !== 1) return null;
	if (candidate.mode !== 'burned-in' && candidate.mode !== 'hidden') return null;
	if (candidate.editable !== false) return null;
	// SAFETY: storage boundary, string check for reason
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- storage boundary string check
	if (typeof candidate.reason !== 'string') return null;
	// SAFETY: test helper at boundary, validated via typed helper
	// SAFETY: validated via field checks above
	return candidate as CursorSidecar;
}
