import { describe, expect, it } from 'vitest';
import type { components } from '$lib/api/types';
import {
	invalidateDependentDestinationSettings,
	loadableDestinationOptionSources,
	mergeDestinationOptions
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

	it('deduplicates available sources and rejects unavailable targeted searches', () => {
		const settings = [
			setting('playlist_id', 'youtube_playlists'),
			setting('secondary_playlist_id', 'youtube_playlists'),
			setting('community_id', 'x_communities', 'Unavailable')
		];

		expect(loadableDestinationOptionSources(settings)).toEqual(['youtube_playlists']);
		expect(loadableDestinationOptionSources(settings, 'youtube_playlists')).toEqual([
			'youtube_playlists'
		]);
		expect(loadableDestinationOptionSources(settings, 'x_communities')).toEqual([]);
	});
});

describe('paged destination options', () => {
	it('appends pages by stable provider value without duplicates', () => {
		expect(
			mergeDestinationOptions(
				[
					{ value: 'board-1', label: 'Board one' },
					{ value: 'board-2', label: 'Old label' }
				],
				[
					{ value: 'board-2', label: 'Board two' },
					{ value: 'board-3', label: 'Board three' }
				]
			)
		).toEqual([
			{ value: 'board-1', label: 'Board one' },
			{ value: 'board-2', label: 'Board two' },
			{ value: 'board-3', label: 'Board three' }
		]);
	});

	it('clears a child selection and invalidates its option source when a parent changes', () => {
		const board = setting('board_id', 'pinterest_boards');
		const section = {
			...setting('section_id', 'pinterest_sections'),
			dependencies: [{ key: 'board_id', operator: 'equals' as const, value: 'board-1' }]
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
