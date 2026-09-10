import { convert, isColor } from '@asamuzakjp/css-color';

export function themePickerColor(previous: string, color: string): string {
	if (!isColor(previous)) return color;
	const alpha = convert.colorToRgb(previous)[3];
	if (!Number.isFinite(alpha) || alpha >= 1) return color;
	const [red, green, blue] = convert.colorToRgb(color);
	return `rgb(${red} ${green} ${blue} / ${alpha})`;
}
