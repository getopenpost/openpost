import { describe, expect, it } from 'vitest';
import type { components } from '$lib/api/types';
import { loadableDestinationOptionSources } from './destination-options';

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
