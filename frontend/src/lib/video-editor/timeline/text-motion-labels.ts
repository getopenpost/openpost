import { m } from '$lib/paraglide/messages';
import type { TextMotionPresetId, TextMotionSlot } from '../project/types';

export function textMotionPresetLabel(presetId: TextMotionPresetId): string {
	switch (presetId) {
		case 'typewriter':
			return m.video_editor_text_motion_typewriter();
		case 'fade-up':
			return m.video_editor_text_motion_fade_up();
		case 'rise':
			return m.video_editor_text_motion_rise();
		case 'cascade':
			return m.video_editor_text_motion_cascade();
		case 'pop':
			return m.video_editor_text_motion_pop();
		case 'blur-in':
			return m.video_editor_text_motion_blur_in();
		case 'slide-mask':
			return m.video_editor_text_motion_slide_mask();
		case 'wave-in':
			return m.video_editor_text_motion_wave_in();
		case 'fade-down':
			return m.video_editor_text_motion_fade_down();
		case 'sink':
			return m.video_editor_text_motion_sink();
		case 'pop-out':
			return m.video_editor_text_motion_pop_out();
		case 'blur-out':
			return m.video_editor_text_motion_blur_out();
		case 'typewriter-erase':
			return m.video_editor_text_motion_typewriter_erase();
		case 'pulse':
			return m.video_editor_text_motion_pulse();
		case 'wave':
			return m.video_editor_text_motion_wave();
		case 'shimmer':
			return m.video_editor_text_motion_shimmer();
		case 'swing':
			return m.video_editor_text_motion_swing();
		default:
			return String(presetId);
	}
}

export function textMotionSlotLabel(slot: TextMotionSlot): string {
	switch (slot) {
		case 'in':
			return m.video_editor_text_motion_in();
		case 'out':
			return m.video_editor_text_motion_out();
		case 'loop':
			return m.video_editor_text_motion_loop();
	}
}
