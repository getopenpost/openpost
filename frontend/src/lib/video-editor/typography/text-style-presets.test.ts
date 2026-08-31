import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import {
	applyTextStylePresetToItem,
	buildTextScale,
	buildTextStylePresetTemplate,
	buildTextStylePresetUpdates
} from './text-style-presets';

const canvas = { width: 1920, height: 1080 };

describe('text style presets', () => {
	it('resolves the exact lower-third and cinematic recipes', () => {
		expect(buildTextStylePresetUpdates('lower-third', canvas)).toMatchObject({
			fontFamily: 'Inter',
			fontWeight: 600,
			textAlign: 'left',
			backgroundColor: '#111827',
			borderRadius: 20,
			paddingX: 24,
			paddingY: 24,
			strokeWidth: undefined
		});
		expect(buildTextStylePresetUpdates('cinematic', canvas)).toMatchObject({
			fontFamily: 'Bebas Neue',
			fontWeight: 400,
			letterSpacing: 4,
			lineHeight: 0.92,
			backgroundColor: undefined,
			strokeWidth: 1,
			strokeColor: '#2b2112'
		});
	});

	it('scales the whole recipe and preserves existing copy', () => {
		const base = buildTextStylePresetUpdates('lower-third', canvas, 1);
		const scaled = buildTextStylePresetUpdates('lower-third', canvas, 1.5);
		expect(scaled.fontSize).toBeGreaterThan(base.fontSize ?? 0);
		expect(scaled.paddingX).toBeGreaterThan(base.paddingX ?? 0);
		expect(scaled.borderRadius).toBeGreaterThan(base.borderRadius ?? 0);
		expect(scaled.textShadow?.blur).toBeGreaterThan(base.textShadow?.blur ?? 0);

		const item: TimelineItem = {
			id: 'text',
			trackId: 'visual',
			from: 0,
			durationInFrames: 90,
			label: 'Custom',
			text: 'My Name\nCreative Director',
			textSpans: [{ text: 'My Name' }, { text: 'Creative Director' }],
			type: 'text'
		};
		expect(applyTextStylePresetToItem(item, 'lower-third', canvas, 1.25)).toMatchObject({
			textStylePresetId: 'lower-third',
			textStyleScale: 1.25,
			text: 'My Name\nCreative Director',
			label: 'My Name',
			textSpans: [
				{ text: 'My Name', fontWeight: 700 },
				{ text: 'Creative Director', color: '#cbd5e1' }
			]
		});
	});

	it('builds structured templates and clamps scale tokens from canvas size', () => {
		expect(buildTextScale(canvas).sizes).toEqual({ badge: 52, title: 92, display: 119 });
		expect(buildTextStylePresetTemplate('headline-stack', canvas).textSpans).toHaveLength(3);
		expect(buildTextStylePresetUpdates('clean-title', canvas).fontSize).toBe(92);
	});
});
