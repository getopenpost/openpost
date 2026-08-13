import { describe, expect, it } from 'vitest';
import type { components } from '$lib/api/types';
import { accountCapabilityNeedsAttention } from './account-attention';

type ResolvedAccountCapability = components['schemas']['ResolvedAccountCapability'];
type ProviderReadinessDecision = components['schemas']['Decision'];
type ValidationIssue = components['schemas']['ValidationIssue'];

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

function issue(code: string, severity: 'error' | 'warning' = 'warning'): ValidationIssue {
	return {
		code,
		severity,
		message: code,
		fallback_message: code
	};
}

function capability(issues: ValidationIssue[], compatible = true): ResolvedAccountCapability {
	return {
		account_id: 'x-account',
		content: {
			body: { required: false },
			title: { required: false },
			description: { required: false },
			alt_text: { required: false }
		},
		available_formats: [],
		segment_strategy: 'preserve',
		active_constraints: {},
		capability_revision: 'test',
		compatible,
		format_selection_required: false,
		immediate_readiness: healthyReadiness(),
		intents: ['post'],
		issues,
		label: 'X post',
		media: {
			allowed_mimes: [],
			aspect_ratios: [],
			max_count: 4,
			max_duration_seconds: 0,
			max_size_bytes: 0,
			min_count: 0,
			requires_https_fetchable: false,
			requires_public_url: false
		},
		media_shapes: ['text'],
		native_scheduling: false,
		openpost_queued: true,
		output_profile: 'x.post',
		profile: 'short_text',
		provider: 'x',
		requires_app_review: false,
		requires_public_media: false,
		scheduled_readiness: healthyReadiness(),
		setting_groups: [],
		text_limit: 280,
		title_required: false,
		description_required: false,
		validation_categories: []
	};
}

describe('accountCapabilityNeedsAttention', () => {
	it('does not mark an account for generic quota information', () => {
		expect(accountCapabilityNeedsAttention(capability([issue('quota_warning')]))).toBe(false);
	});

	it('marks actionable warnings and incompatible accounts', () => {
		expect(accountCapabilityNeedsAttention(capability([issue('media_aspect')]))).toBe(true);
		expect(accountCapabilityNeedsAttention(capability([issue('quota_warning')], false))).toBe(true);
	});

	it('leaves shared missing-media feedback on the composer control', () => {
		expect(
			accountCapabilityNeedsAttention(capability([issue('media_required', 'error')], false))
		).toBe(false);
	});
});
