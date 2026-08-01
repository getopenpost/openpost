import { m } from '$lib/paraglide/messages';
import { VideoPreparationError } from './types';

export function videoPreparationErrorMessage(cause: unknown, fallback: string): string {
	if (!(cause instanceof VideoPreparationError)) {
		return cause instanceof Error ? cause.message : fallback;
	}
	switch (cause.code) {
		case 'no-video-track':
			return m.video_error_no_track();
		case 'cannot-decode':
			return m.video_error_cannot_decode();
		case 'too-long':
			return m.video_error_too_long();
		case 'encoder-unavailable':
			return m.video_error_encoder_unavailable();
		case 'cannot-fit':
			return m.video_error_cannot_fit();
		case 'invalid-edit':
			return m.video_error_invalid_edit();
	}
}
