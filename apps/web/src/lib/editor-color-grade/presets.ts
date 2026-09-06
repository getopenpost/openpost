import type { EditorColorGradeAdjustments } from './model';
import { m } from '$lib/paraglide/messages';

export type EditorColorGradePresetID = 'original' | 'crisp' | 'warm' | 'cool' | 'mono';

export interface EditorColorGradePreset {
	id: EditorColorGradePresetID;
	adjustments: Partial<EditorColorGradeAdjustments>;
}

/** Built-in looks shared by both editor color workspaces. */
export const EDITOR_COLOR_GRADE_PRESETS: readonly EditorColorGradePreset[] = [
	{ id: 'original', adjustments: {} },
	{
		id: 'crisp',
		adjustments: { contrast: 0.14, vibrance: 0.12, highlights: -0.08, shadows: 0.08 }
	},
	{
		id: 'warm',
		adjustments: { temperature: 0.18, tint: 0.04, vibrance: 0.08 }
	},
	{
		id: 'cool',
		adjustments: { temperature: -0.16, tint: -0.03, contrast: 0.05 }
	},
	{
		id: 'mono',
		adjustments: { saturation: -1, contrast: 0.12, shadows: 0.08 }
	}
];

export function editorColorGradePresetLabel(id: EditorColorGradePresetID): string {
	if (id === 'original') return m.image_editor_look_original();
	if (id === 'crisp') return m.image_editor_look_crisp();
	if (id === 'warm') return m.image_editor_look_warm();
	if (id === 'cool') return m.image_editor_look_cool();
	return m.image_editor_look_mono();
}
