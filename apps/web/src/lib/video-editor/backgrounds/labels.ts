import { getPaperShader } from '../effects/paper/catalog';
import { paperLabel } from '../effects/paper/i18n';
import { m } from '$lib/paraglide/messages';

export function backgroundPresetLabel(id: string): string {
	if (id.startsWith('shader-paper-')) {
		const shader = getPaperShader(id.slice(13));
		if (shader) return paperLabel(shader.label);
	}
	switch (id) {
		case 'shader-aurora':
			return m.video_editor_shader_aurora();
		case 'shader-dusk':
			return m.video_editor_shader_dusk();
		case 'shader-ribbons':
			return m.video_editor_shader_ribbons();
		case 'shader-mono':
			return m.video_editor_shader_mono();
		case 'shader-clouds':
			return m.video_editor_shader_clouds();
		case 'shader-neural':
			return m.video_editor_shader_neural();
		case 'mesh-sunset':
			return m.video_editor_background_preset_mesh_sunset();
		case 'mesh-ocean':
			return m.video_editor_background_preset_mesh_ocean();
		case 'mesh-forest':
			return m.video_editor_background_preset_mesh_forest();
		case 'mesh-neon':
			return m.video_editor_background_preset_mesh_neon();
		case 'pattern-dots':
			return m.video_editor_background_preset_pattern_dots();
		case 'pattern-grid':
			return m.video_editor_background_preset_pattern_grid();
		case 'pattern-stripes':
			return m.video_editor_background_preset_pattern_stripes();
		case 'pattern-checker':
			return m.video_editor_background_preset_pattern_checker();
		default:
			return id;
	}
}
