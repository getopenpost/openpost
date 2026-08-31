import { m } from '$lib/paraglide/messages';
import type { CaptionStylePresetId } from './caption-style-presets';

export function captionStylePresetLabel(id: CaptionStylePresetId): string {
	switch (id) {
		case 'netflix':
			return m.video_editor_caption_preset_netflix();
		case 'youtube':
			return m.video_editor_caption_preset_youtube();
		case 'bold-yellow':
			return m.video_editor_caption_preset_bold_yellow();
		case 'minimal-stroke':
			return m.video_editor_caption_preset_outlined();
		case 'tiktok':
			return m.video_editor_caption_preset_tiktok();
	}
}
