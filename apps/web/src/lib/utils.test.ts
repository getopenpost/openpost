import { describe, expect, it } from 'vitest';
import {
	formatAccountHandle,
	getPlatformColor,
	getPlatformKey,
	formatSocialAccountName
} from './utils';

describe('formatAccountHandle', () => {
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

	it('keeps Pinterest and Google Business unprefixed', () => {
		expect(formatSocialAccountName('acme', 'pinterest')).toBe('acme');
		expect(formatSocialAccountName('acme', 'googlebusiness')).toBe('acme');
		expect(formatSocialAccountName('acme', 'gmb')).toBe('acme');
	});

	it('prefixes every handle-first platform', () => {
		for (const platform of [
			'bluesky',
			'devnull',
			'instagram',
			'mastodon',
			'pixelfed',
			'threads',
			'tiktok',
			'x',
			'twitter'
		]) {
			expect(formatSocialAccountName('acme', platform)).toBe('@acme');
		}
	});
});

describe('getPlatformKey', () => {
	it('canonicalizes the Google Business alias', () => {
		expect(getPlatformKey('gmb')).toBe('googlebusiness');
		expect(getPlatformKey('googlebusiness')).toBe('googlebusiness');
	});

	it('resolves the legacy twitter alias, even padded or instance-qualified', () => {
		expect(getPlatformKey('twitter')).toBe('x');
		expect(getPlatformKey(' twitter ')).toBe('x');
		expect(getPlatformKey('Twitter:instance')).toBe('x');
		expect(getPlatformKey('x:instance')).toBe('x');
	});

	it('trims and case-folds before stripping the instance suffix', () => {
		expect(getPlatformKey(' GMB ')).toBe('googlebusiness');
		expect(getPlatformKey('Mastodon:https://masto.pt')).toBe('mastodon');
	});

	it('passes unknown keys through without resolving prototype properties', () => {
		expect(getPlatformKey('constructor')).toBe('constructor');
		expect(getPlatformColor('constructor')).toBe('bg-gray-500');
	});
});

describe('getPlatformColor', () => {
	it('resolves aliases and instance suffixes through the shared key', () => {
		expect(getPlatformColor('twitter')).toBe('bg-black');
		expect(getPlatformColor('twitter:instance')).toBe('bg-black');
		expect(getPlatformColor('gmb')).toBe(getPlatformColor('googlebusiness'));
	});
});
