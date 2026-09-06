import { m } from '$lib/paraglide/messages';
import type { TextStylePresetId } from '../project/types';
import type { TextStylePresetCopy } from './text-style-presets';

export function localizedTextStylePresetLabel(id: TextStylePresetId): string {
	switch (id) {
		case 'clean-title':
			return m.video_editor_text_preset_clean();
		case 'poster':
			return m.video_editor_text_preset_poster();
		case 'outline-pill':
			return m.video_editor_text_preset_outline();
		case 'lower-third':
			return m.video_editor_text_preset_lower_third();
		case 'speaker-card':
			return m.video_editor_text_preset_speaker();
		case 'cinematic':
			return m.video_editor_text_preset_cinematic();
		case 'quote':
			return m.video_editor_text_preset_quote();
		case 'neon':
			return m.video_editor_text_preset_neon();
		case 'headline-stack':
			return m.video_editor_text_preset_headline();
		case 'breaking-update':
			return m.video_editor_text_preset_breaking();
		case 'event-card':
			return m.video_editor_text_preset_event();
		case 'launch-stack':
			return m.video_editor_text_preset_launch();
		case 'badge':
			return m.video_editor_text_preset_badge();
	}
}

export function localizedTextStylePresetCopy(id: TextStylePresetId): TextStylePresetCopy {
	const label = localizedTextStylePresetLabel(id);
	switch (id) {
		case 'clean-title':
			return {
				label,
				sample: {
					title: m.video_editor_text_sample_main(),
					subtitle: m.video_editor_text_sample_title()
				}
			};
		case 'poster':
			return { label, sample: { title: m.video_editor_text_sample_tonight() } };
		case 'outline-pill':
			return {
				label,
				sample: { title: m.video_editor_text_sample_featured() }
			};
		case 'lower-third':
			return {
				label,
				sample: {
					title: m.video_editor_text_sample_name(),
					subtitle: m.video_editor_text_sample_role()
				}
			};
		case 'speaker-card':
			return {
				label,
				sample: {
					title: 'Alex Morgan',
					subtitle: m.video_editor_text_sample_product_designer()
				}
			};
		case 'cinematic':
			return {
				label,
				sample: {
					title: m.video_editor_text_sample_cinema(),
					subtitle: m.video_editor_text_sample_presents()
				}
			};
		case 'quote':
			return {
				label,
				sample: {
					title: m.video_editor_text_sample_quote(),
					subtitle: m.video_editor_text_sample_attribution()
				}
			};
		case 'neon':
			return {
				label,
				sample: {
					title: m.video_editor_text_sample_neon(),
					subtitle: m.video_editor_text_sample_glow()
				}
			};
		case 'headline-stack':
			return {
				label,
				sample: {
					eyebrow: m.video_editor_text_sample_top_story(),
					title: m.video_editor_text_sample_headline(),
					subtitle: m.video_editor_text_sample_subhead()
				}
			};
		case 'breaking-update':
			return {
				label,
				sample: {
					eyebrow: m.video_editor_text_sample_breaking(),
					title: m.video_editor_text_sample_major_update(),
					subtitle: m.video_editor_text_sample_developing()
				}
			};
		case 'event-card':
			return {
				label,
				sample: {
					eyebrow: m.video_editor_text_sample_live(),
					title: m.video_editor_text_sample_summer_fest(),
					subtitle: m.video_editor_text_sample_friday_time()
				}
			};
		case 'launch-stack':
			return {
				label,
				sample: {
					eyebrow: m.video_editor_text_sample_now_live(),
					title: m.video_editor_text_sample_new_collection(),
					subtitle: m.video_editor_text_sample_shop_drop()
				}
			};
		case 'badge':
			return {
				label,
				sample: {
					title: m.video_editor_text_sample_new_drop(),
					subtitle: m.video_editor_text_sample_tag()
				}
			};
	}
}
