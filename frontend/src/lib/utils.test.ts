import { describe, expect, it } from 'vitest';
import {
	formatAccountHandle,
	formatAccountPlatformLabel,
	formatSocialAccountLabel,
	formatSocialAccountName
} from './utils';

describe('formatAccountHandle', () => {
	it('adds a handle prefix when it is missing', () => {
		expect(formatAccountHandle('rodgds')).toBe('@rodgds');
	});

	it('does not duplicate an existing handle prefix', () => {
		expect(formatAccountHandle('@rodgds')).toBe('@rodgds');
	});

	it('normalizes whitespace and repeated prefixes', () => {
		expect(formatAccountHandle('  @@rodgds  ')).toBe('@rodgds');
	});

	it('returns an empty string when no username is available', () => {
		expect(formatAccountHandle(undefined)).toBe('');
		expect(formatAccountHandle('@@')).toBe('');
	});
});

describe('formatSocialAccountName', () => {
	it('adds a handle prefix for handle-first platforms', () => {
		expect(formatSocialAccountName('rodgds', 'bluesky')).toBe('@rodgds');
		expect(formatSocialAccountName('rodgds', 'twitter')).toBe('@rodgds');
		expect(formatSocialAccountName('rodgds@masto.pt', 'mastodon:https://masto.pt')).toBe(
			'@rodgds@masto.pt'
		);
	});

	it('keeps display-name platforms unprefixed', () => {
		expect(formatSocialAccountName('Rodrigo', 'linkedin')).toBe('Rodrigo');
		expect(formatSocialAccountName('OpenPost Studio', 'youtube')).toBe('OpenPost Studio');
	});
});

describe('formatSocialAccountLabel', () => {
	it('keeps identical handles distinct by including the platform', () => {
		expect(formatSocialAccountLabel('rodrgds', 'bluesky')).toBe('@rodrgds · Bluesky');
		expect(formatSocialAccountLabel('rodrgds', 'threads')).toBe('@rodrgds · Threads');
	});

	it('uses the platform or supplied fallback when the username is missing', () => {
		expect(formatSocialAccountLabel('', 'linkedin')).toBe('LinkedIn');
		expect(formatSocialAccountLabel('', 'linkedin', 'OpenPost team')).toBe(
			'OpenPost team · LinkedIn'
		);
	});
});

describe('formatAccountPlatformLabel', () => {
	it('combines an already resolved account name and platform label', () => {
		expect(formatAccountPlatformLabel('OpenPost team', 'LinkedIn')).toBe(
			'OpenPost team · LinkedIn'
		);
		expect(formatAccountPlatformLabel('LinkedIn', 'LinkedIn')).toBe('LinkedIn');
	});
});
