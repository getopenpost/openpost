/* Capture truth: browser capability detection for cursor and system/tab audio */

export type CursorMode = 'always' | 'motion' | 'never';
export type SystemAudioStatus =
	| 'not-requested'
	| 'requested'
	| 'active'
	| 'inactive'
	| 'unavailable'
	| 'denied';

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

export function systemAudioStatusLabel(
	status: SystemAudioStatus,
	t: (key: string) => string
): string {
	switch (status) {
		case 'not-requested':
			return t('video_editor_system_audio_not_requested');
		case 'active':
			return t('video_editor_system_audio_active');
		case 'inactive':
			return t('video_editor_system_audio_inactive');
		case 'unavailable':
			return t('video_editor_system_audio_unavailable');
		case 'denied':
			return t('video_editor_system_audio_denied');
		case 'requested':
			return t('video_editor_system_audio_requested');
		default:
			return status;
	}
}
