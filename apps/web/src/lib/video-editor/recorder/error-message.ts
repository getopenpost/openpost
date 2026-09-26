import { m } from '$lib/paraglide/messages';
import type { RecorderErrorCode } from './record-mime';

export function recorderErrorMessage(error: RecorderErrorCode | null): string {
	switch (error) {
		case 'screen-share-not-started':
			return m.video_editor_recording_screen_share_not_started();
		case 'permission-denied':
			return m.video_editor_recording_error_permission();
		case 'no-device':
			return m.video_editor_recording_error_device_missing();
		case 'device-busy':
			return m.video_editor_recording_error_device_busy();
		case 'storage-full':
			return m.video_editor_recording_storage_stopped();
		case 'unsupported':
			return m.video_editor_recording_error_unsupported();
		case 'stop-timeout':
			return m.video_editor_recording_error_stop_timeout();
		default:
			return m.video_editor_recording_error_start();
	}
}
