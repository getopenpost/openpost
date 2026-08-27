/* Capture truth: browser capability detection for cursor and system/tab audio */

import type { RecordingSystemAudioStatus } from '../media/types';

export type CursorMode = 'always' | 'motion' | 'never';
export type CursorActualMode = CursorMode | 'unsupported' | 'unknown';
export type SystemAudioStatus = RecordingSystemAudioStatus;

export interface RecordingCapabilities {
	hasDisplayMedia: boolean;
	hasUserMedia: boolean;
	cursor: {
		supported: boolean;
		modes: CursorMode[];
	};
	systemAudio: {
		canRequest: boolean;
	};
}

function hasNavigator(): boolean {
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- browser probe
	return typeof navigator !== 'undefined';
}

function getSupportedConstraints(): MediaTrackSupportedConstraints | null {
	try {
		if (!hasNavigator() || !navigator.mediaDevices?.getSupportedConstraints) return null;
		return navigator.mediaDevices.getSupportedConstraints();
	} catch {
		return null;
	}
}

export function detectRecordingCapabilities(): RecordingCapabilities {
	const hasDisplayMedia = Boolean(hasNavigator() && navigator.mediaDevices?.getDisplayMedia);
	const hasUserMedia = Boolean(hasNavigator() && navigator.mediaDevices?.getUserMedia);
	const supported = getSupportedConstraints();
	const cursorSupported = Boolean(supported && 'cursor' in supported && supported.cursor);
	const modes: CursorMode[] = cursorSupported ? ['always', 'motion', 'never'] : [];
	return {
		hasDisplayMedia,
		hasUserMedia,
		cursor: {
			supported: cursorSupported,
			modes
		},
		systemAudio: {
			canRequest: hasDisplayMedia
		}
	};
}

export function resolveCursorConstraint(
	requested: CursorMode,
	capabilities: RecordingCapabilities
): CursorMode | null {
	if (!capabilities.cursor.supported) return null;
	if (capabilities.cursor.modes.includes(requested)) return requested;
	return 'always';
}

export function readActualCursor(
	stream: MediaStream | null,
	capabilities: RecordingCapabilities
): CursorActualMode {
	if (!capabilities.cursor.supported) return 'unsupported';
	if (!stream) return 'unknown';
	const track = stream.getVideoTracks()[0];
	if (!track) return 'unknown';
	try {
		// SAFETY: getSettings may include cursor for display capture per spec; checked via typeof
		const settings = track.getSettings() as MediaTrackSettings & { cursor?: string };
		const value = settings.cursor;
		if (value === 'always' || value === 'motion' || value === 'never') return value;
		return 'unknown';
	} catch {
		return 'unknown';
	}
}

export function isSystemAudioActive(stream: MediaStream | null): boolean {
	if (!stream) return false;
	const tracks = stream.getAudioTracks();
	if (tracks.length === 0) return false;
	return tracks.some((track) => track.readyState === 'live' && track.enabled && !track.muted);
}

export function deriveSystemAudioStatus(args: {
	requested: boolean;
	stream: MediaStream | null;
	error?: unknown;
	capabilities?: RecordingCapabilities;
}): SystemAudioStatus {
	if (!args.requested) return 'not-requested';
	if (args.error instanceof DOMException) {
		if (args.error.name === 'NotAllowedError' || args.error.name === 'SecurityError')
			return 'denied';
	}
	if (!args.capabilities?.hasDisplayMedia) return 'unavailable';
	if (!args.stream) return 'unavailable';
	if (isSystemAudioActive(args.stream)) return 'active';
	return 'inactive';
}

export { reconcileSystemAudioWithProbe } from '../media/recording-capture-schema';
