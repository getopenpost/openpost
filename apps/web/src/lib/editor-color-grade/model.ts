export const IMAGE_COLOR_GRADE_VERSION = 1 as const;

export interface EditorColorGradeAdjustments {
	brightness: number;
	contrast: number;
	saturation: number;
	temperature: number;
	tint: number;
	vibrance: number;
	hue: number;
	exposure: number;
	highlights: number;
	shadows: number;
}

export function defaultEditorColorGradeAdjustments(): EditorColorGradeAdjustments {
	return {
		brightness: 0,
		contrast: 0,
		saturation: 0,
		temperature: 0,
		tint: 0,
		vibrance: 0,
		hue: 0,
		exposure: 0,
		highlights: 0,
		shadows: 0
	};
}
