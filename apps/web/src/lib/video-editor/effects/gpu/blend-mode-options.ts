import type { AppSelectOption } from '$lib/components/app-select.svelte';
import { m } from '$lib/paraglide/messages';
import { BLEND_MODE_GROUPS, type BlendMode } from './blend-modes';

/** Localized grouped options shared by every compositor blend picker. */
export function getBlendModeOptions(): AppSelectOption[] {
	const modeLabels = {
		normal: m.video_editor_blend_normal(),
		dissolve: m.video_editor_blend_dissolve(),
		darken: m.video_editor_blend_darken(),
		multiply: m.video_editor_blend_multiply(),
		'color-burn': m.video_editor_blend_color_burn(),
		'linear-burn': m.video_editor_blend_linear_burn(),
		lighten: m.video_editor_blend_lighten(),
		screen: m.video_editor_blend_screen(),
		'color-dodge': m.video_editor_blend_color_dodge(),
		'linear-dodge': m.video_editor_blend_linear_dodge(),
		overlay: m.video_editor_blend_overlay(),
		'soft-light': m.video_editor_blend_soft_light(),
		'hard-light': m.video_editor_blend_hard_light(),
		'vivid-light': m.video_editor_blend_vivid_light(),
		'linear-light': m.video_editor_blend_linear_light(),
		'pin-light': m.video_editor_blend_pin_light(),
		'hard-mix': m.video_editor_blend_hard_mix(),
		difference: m.video_editor_blend_difference(),
		exclusion: m.video_editor_blend_exclusion(),
		subtract: m.video_editor_blend_subtract(),
		divide: m.video_editor_blend_divide(),
		hue: m.video_editor_blend_hue(),
		saturation: m.video_editor_blend_saturation(),
		color: m.video_editor_blend_color(),
		luminosity: m.video_editor_blend_luminosity()
	} satisfies Record<BlendMode, string>;
	const groupLabels = {
		normal: m.video_editor_blend_group_normal(),
		darken: m.video_editor_blend_group_darken(),
		lighten: m.video_editor_blend_group_lighten(),
		contrast: m.video_editor_blend_group_contrast(),
		inversion: m.video_editor_blend_group_inversion(),
		component: m.video_editor_blend_group_component()
	} satisfies Record<(typeof BLEND_MODE_GROUPS)[number]['label'], string>;
	return BLEND_MODE_GROUPS.flatMap((group) =>
		group.modes.map((mode) => ({
			value: mode,
			label: `${groupLabels[group.label]}: ${modeLabels[mode]}`
		}))
	);
}
