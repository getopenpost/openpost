import { describe, expect, it } from 'vitest';
import {
	clearBuilderMediaHandoff,
	createBuilderMediaHandoffSearch,
	parseBuilderMediaHandoff
} from './builder-media-handoff';

describe('builder media handoffs', () => {
	it('carries a video brief and source through the composer URL', () => {
		const search = createBuilderMediaHandoffSearch({
			kind: 'video',
			brief: 'Cut to the feature reveal.',
			accountId: 'account-1',
			sourceMediaId: 'video-1',
			sourceLabel: 'demo.mp4'
		});
		const url = new URL(`https://openpost.test/publications/post-1?${search.toString()}`);

		expect(parseBuilderMediaHandoff(url)).toEqual({
			kind: 'video',
			brief: 'Cut to the feature reveal.',
			accountId: 'account-1',
			sourceMediaId: 'video-1',
			sourceLabel: 'demo.mp4'
		});
		expect(clearBuilderMediaHandoff(url).search).toBe('');
	});

	it('ignores an unknown media tool', () => {
		expect(
			parseBuilderMediaHandoff(
				new URL('https://openpost.test/publications/post-1?builder_media=unknown')
			)
		).toBeNull();
	});
});
