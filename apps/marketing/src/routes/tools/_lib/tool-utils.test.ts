import { describe, expect, it } from 'vitest';
import { counterPlatforms, marketingRouteManifest, previewTools } from '@openpost/social-images';
import { toolArticles } from '../_articles';
import { COUNTER_PLATFORMS, platformTextCount, splitSmartThread } from './tool-utils';

describe('public text tools', () => {
	it('uses the publishing count rules for platform text', () => {
		expect(platformTextCount('é', 'threads')).toBe(1);
		expect(platformTextCount('日本語', 'threads')).toBe(3);
		expect(platformTextCount('❤️', 'threads')).toBe(6);
		expect(platformTextCount('example.com', 'x')).toBe(23);
		expect(platformTextCount('https://example.com.', 'x')).toBe(24);
		expect(platformTextCount('👨‍👩‍👧‍👦', 'bluesky')).toBe(1);
		expect(platformTextCount('👨‍👩‍👧‍👦', 'mastodon')).toBe(7);
	});

	it('splits Threads text without exceeding the platform limit', () => {
		const limit = COUNTER_PLATFORMS.find((item) => item.key === 'threads')!.limit;
		const parts = splitSmartThread('é'.repeat(1200), 'threads', limit, true);
		expect(parts.length).toBeGreaterThan(1);
		expect(parts.every((part) => platformTextCount(part.text, 'threads') <= limit)).toBe(true);
	});

	it('advertises the number of platforms the counter renders', () => {
		const entry = marketingRouteManifest.find(
			(route) => route.path === '/tools/multi-platform-character-counter'
		);
		expect(entry).toBeDefined();
		const match = /\b(\d+) social networks\b/u.exec(entry!.description);
		expect(match?.[1]).toBe(String(COUNTER_PLATFORMS.length));
		expect(COUNTER_PLATFORMS.map((platform) => platform.key)).toEqual(
			counterPlatforms.map((platform) => platform.key)
		);
		for (const platform of COUNTER_PLATFORMS) {
			expect(Number.isFinite(platform.limit)).toBe(true);
			expect(platform.name.length).toBeGreaterThan(0);
			expect(platform.note.length).toBeGreaterThan(0);
		}
	});

	it('marks preview-only catalogue entries with a no-publishing guide section', () => {
		const marked = previewTools.filter((tool) => tool.previewOnly);
		expect(marked.map((tool) => tool.slug)).toContain('reddit-post-preview');
		for (const tool of previewTools) {
			const article = toolArticles[tool.slug];
			expect(article).toBeDefined();
			const guideText: string[] = article.sections.flatMap(
				(section: { title: string; paragraphs: readonly string[] }) => [
					section.title,
					...section.paragraphs
				]
			);
			const platformName = tool.name.replace(' post preview', '');
			if (tool.previewOnly) {
				expect(
					guideText.some(
						(text: string) =>
							text.includes(`does not publish to ${platformName}`) && text.includes('native layout')
					)
				).toBe(true);
			} else {
				expect(guideText.some((text: string) => text.includes('does not publish to'))).toBe(false);
			}
		}
	});
});
