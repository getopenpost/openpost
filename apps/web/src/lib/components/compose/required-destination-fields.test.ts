import { describe, expect, it } from 'vitest';
import type { components } from '$lib/api/types';
import {
	activeRequiredDestinationFields,
	requiredFieldIsMissing
} from './required-destination-fields';

type ResolvedAccountCapability = components['schemas']['ResolvedAccountCapability'];
type ProviderReadinessDecision = components['schemas']['Decision'];
type SettingDefinition = components['schemas']['SettingDefinition'];

function healthyReadiness(): ProviderReadinessDecision {
	return {
		advertisable: true,
		connectable: true,
		executable: true,
		facts: {
			approval: 'approved',
			authorization: 'authorized',
			configuration: 'configured',
			control: 'enabled',
			live_certification: 'passed',
			local_test: 'passed',
			policy: 'allowed'
		},
		publishable: true,
		state: 'healthy'
	};
}

function capability(settings: SettingDefinition[]): ResolvedAccountCapability {
	return {
		account_id: 'youtube-1',
		content: {
			body: { required: false },
			title: { required: false },
			description: { required: false },
			alt_text: { required: false }
		},
		active_constraints: {},
		available_formats: [],
		capability_revision: 'test',
		compatible: false,
		format_selection_required: false,
		immediate_readiness: healthyReadiness(),
		intents: [],
		issues: [],
		label: 'YouTube video',
		media: {
			min_count: 1,
			max_count: 1,
			allowed_mimes: [],
			requires_public_url: false,
			requires_https_fetchable: false
		},
		media_shapes: [],
		native_scheduling: false,
		openpost_queued: true,
		output_profile: 'youtube.video',
		profile: 'long_video',
		provider: 'youtube',
		requires_app_review: false,
		requires_public_media: false,
		scheduled_readiness: healthyReadiness(),
		segment_strategy: 'join',
		setting_groups: [{ key: 'content', settings }]
	};
}

describe('activeRequiredDestinationFields', () => {
	it('returns every active required destination field', () => {
		const title = {
			key: 'title',
			label: 'Title',
			message_key: 'title',
			group: 'content',
			control: 'text',
			type: 'text',
			scope: 'destination',
			required: true
		} satisfies SettingDefinition;
		const strategy = {
			key: 'graduation_strategy',
			label: 'Graduation',
			message_key: 'graduation',
			group: 'distribution',
			control: 'select',
			type: 'select',
			scope: 'destination',
			required: true,
			dependencies: [{ key: 'is_trial_reel', operator: 'equals', value: true }]
		} satisfies SettingDefinition;
		const result = activeRequiredDestinationFields(
			['youtube-1'],
			{ 'youtube-1': capability([title, strategy]) },
			{ 'youtube-1': { is_trial_reel: false } }
		);
		expect(result.map((field) => field.setting.key)).toEqual(['title']);
	});

	it('includes conditional fields once their dependency is active', () => {
		const setting = {
			key: 'music_usage_confirmed',
			label: 'Music rights',
			message_key: 'music',
			group: 'disclosure',
			control: 'checkbox',
			type: 'boolean',
			scope: 'destination',
			required: true,
			dependencies: [{ key: 'content_posting_method', operator: 'equals', value: 'DIRECT_POST' }]
		} satisfies SettingDefinition;
		const result = activeRequiredDestinationFields(
			['youtube-1'],
			{ 'youtube-1': capability([setting]) },
			{ 'youtube-1': { content_posting_method: 'DIRECT_POST' } }
		);
		expect(result).toHaveLength(1);
		expect(requiredFieldIsMissing(setting, { music_usage_confirmed: false })).toBe(true);
		expect(requiredFieldIsMissing(setting, { music_usage_confirmed: true })).toBe(false);
	});
});
