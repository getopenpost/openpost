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

export interface EditorColorWheels {
	shadowsHue: number;
	shadowsAmount: number;
	midtonesHue: number;
	midtonesAmount: number;
	highlightsHue: number;
	highlightsAmount: number;
	offsetHue: number;
	offsetAmount: number;
	lift: number;
	gamma: number;
	gain: number;
	offset: number;
}
export interface EditorColorCurves {
	masterPoints?: string;
	redPoints?: string;
	greenPoints?: string;
	bluePoints?: string;
}
export interface EditorColorGrade extends EditorColorGradeAdjustments {
	wheels?: EditorColorWheels;
	curves?: EditorColorCurves;
}
export function defaultEditorColorWheels(): EditorColorWheels {
	return {
		shadowsHue: 0,
		shadowsAmount: 0,
		midtonesHue: 0,
		midtonesAmount: 0,
		highlightsHue: 0,
		highlightsAmount: 0,
		offsetHue: 0,
		offsetAmount: 0,
		lift: 0,
		gamma: 1,
		gain: 1,
		offset: 0
	};
}
export function hasEditorColorGrade(grade: EditorColorGrade | undefined): boolean {
	if (!grade) return false;
	const { wheels, curves, ...adjustments } = grade;
	if (Object.values(adjustments).some((value) => Math.abs(value) > 0.0001)) return true;
	const defaults = defaultEditorColorWheels();
	return (
		Boolean(
			wheels &&
			Object.entries(wheels).some(([key, value]) => {
				// SAFETY: The validated wheel model only contains keys from EditorColorWheels.
				return Math.abs(value - defaults[key as keyof EditorColorWheels]) > 0.0001;
			})
		) || Boolean(curves && Object.values(curves).some(Boolean))
	);
}

export function validEditorColorTools(grade: Pick<EditorColorGrade, 'wheels' | 'curves'>): boolean {
	if (grade.wheels) {
		for (const [key, value] of Object.entries(grade.wheels)) {
			const min = key === 'lift' || key === 'offset' ? -2 : 0;
			const max = key.endsWith('Hue')
				? 360
				: key === 'gamma'
					? 4
					: key === 'gain'
						? 16
						: key.endsWith('Amount')
							? 1
							: 2;
			if (
				!(key in defaultEditorColorWheels()) ||
				!Number.isFinite(value) ||
				value < min ||
				value > max
			)
				return false;
		}
	}
	for (const [key, text] of Object.entries(grade.curves ?? {})) {
		if (
			!['masterPoints', 'redPoints', 'greenPoints', 'bluePoints'].includes(key) ||
			!isCurveText(text) ||
			text.length > 1024
		)
			return false;
		if (!text) continue;
		try {
			const points: unknown = JSON.parse(text);
			if (!Array.isArray(points) || points.length < 2 || points.length > 16) return false;
			if (points[0]?.[0] !== 0 || points.at(-1)?.[0] !== 1) return false;
			for (let index = 0; index < points.length; index++) {
				const point = points[index];
				if (
					!Array.isArray(point) ||
					point.length !== 2 ||
					!Number.isFinite(point[0]) ||
					!Number.isFinite(point[1]) ||
					point[1] < 0 ||
					point[1] > 1 ||
					point[0] < 0 ||
					point[0] > 1 ||
					(index > 0 && point[0] - points[index - 1]![0] < 0.039999)
				)
					return false;
			}
		} catch {
			return false;
		}
	}
	return true;
}

function isCurveText(value: unknown): value is string {
	return typeof value === 'string';
}
