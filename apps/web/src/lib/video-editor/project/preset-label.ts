import { m } from '$lib/paraglide/messages';
import type { ProjectPresetId } from './project-presets';

export function projectPresetName(id: ProjectPresetId): string {
	switch (id) {
		case 'youtube-1080p':
			return m.video_editor_project_preset_youtube();
		case 'vertical-9-16':
			return m.video_editor_project_preset_vertical();
		case 'instagram-square':
			return m.video_editor_project_preset_instagram_square();
		case 'instagram-portrait':
			return m.video_editor_project_preset_instagram_portrait();
		case 'x-landscape':
			return m.video_editor_project_preset_x();
		case 'linkedin-landscape':
			return m.video_editor_project_preset_linkedin();
	}
}
