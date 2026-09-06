import { describe, expect, it } from 'vitest';
import type { components } from '$lib/api/types';
import {
	composerDestinationSettings,
	invalidateDependentDestinationSettings,
	loadableDestinationOptionSources
} from './destination-options';

type SettingDefinition = components['schemas']['SettingDefinition'];

function setting(key: string, optionsSource: string, unavailableReason = ''): SettingDefinition {
	return {
		key,
		message_key: `publishing.setting.${key.replaceAll('_', '.')}`,
		label: key,
		group: 'distribution',
		control: 'remote_picker',
		type: 'select',
		scope: 'destination',
		intents: ['post'],
		output_profiles: ['x.post'],
		media_shapes: ['text'],
		required: false,
		required_policy: 'never',
		options_source: optionsSource,
		unavailable_reason: unavailableReason,
		constraints: {}
	};
}

describe('loadableDestinationOptionSources', () => {
	it('omits remote sources for unavailable account settings', () => {
		expect(
			loadableDestinationOptionSources([
				setting(
					'community_id',
					'x_communities',
					'X has not granted this account access to Community publishing options.'
				),
				setting(
					'location_id',
					'x_locations',
					'X has not granted this account access to location publishing options.'
				)
			])
		).toEqual([]);
	});
});

describe('composerDestinationSettings', () => {
	it('keeps YouTube settings available before a compatible video is attached', () => {
		const privacy = setting('privacy', '');
		const title = setting('title', '');
		const catalog = [
			{
				capability_revision: 'test',
				content: {},
				intents: ['short_video'],
				label: 'YouTube Short',
				media: {},
				media_shapes: ['video'],
				native_scheduling: false,
				openpost_queued: true,
				output_profile: 'youtube.short',
				profile: 'short_video',
				provider: 'youtube',
				requires_app_review: false,
				requires_public_media: false,
				settings: [privacy, title]
			}
		];

		expect(composerDestinationSettings('youtube', [], catalog, 'youtube.short')).toEqual([
			privacy,
			title
		]);
	});
});

describe('paged destination options', () => {
	it('clears a child selection and invalidates its option source when a parent changes', () => {
		const board = setting('board_id', 'pinterest_boards');
		const section = {
			...setting('section_id', 'pinterest_sections'),
			dependencies: [{ key: 'board_id', operator: 'present' as const }]
		};
		const result = invalidateDependentDestinationSettings(
			[board, section],
			{ board_id: 'board-1', section_id: 'section-7' },
			'board_id',
			'board-2'
		);

		expect(result.values).toEqual({ board_id: 'board-2' });
		expect(result.optionSources).toEqual(['pinterest_sections']);
	});
});
