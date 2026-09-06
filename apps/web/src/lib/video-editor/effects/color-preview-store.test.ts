import { beforeEach, describe, expect, it } from 'vitest';
import type { GpuEffect } from './types';
import { colorPreviewStore } from './color-preview-store.svelte';

const primary: GpuEffect = {
	id: 'primary-wheels',
	type: 'gpu',
	effectId: 'gpu-color-wheels',
	enabled: true,
	params: { lift: 0.1, gain: 1.4 }
};

describe('color effect previews', () => {
	beforeEach(() => colorPreviewStore.__resetForTesting());

	it('patches each selected item grade and previews first-use effects', () => {
		colorPreviewStore.setEffectDraft(
			'primary',
			primary,
			{ lift: 0.25 },
			['primary-wheels', 'secondary-wheels'],
			['primary', 'secondary', 'fresh']
		);

		const primaryPreview = colorPreviewStore.applyEffectDraft('primary', [primary]);
		expect(primaryPreview[0]).toMatchObject({
			params: { lift: 0.25, gain: 1.4 }
		});

		const secondaryPreview = colorPreviewStore.applyEffectDraft('secondary', [
			{
				id: 'secondary-wheels',
				type: 'gpu',
				effectId: 'gpu-color-wheels',
				enabled: true,
				params: { lift: -0.1, saturation: 0.8 }
			}
		]);
		expect(secondaryPreview[0]).toMatchObject({
			params: { lift: 0.25, saturation: 0.8 }
		});

		const freshPreview = colorPreviewStore.applyEffectDraft('fresh', []);
		expect(freshPreview).toHaveLength(1);
		expect(freshPreview[0]).toMatchObject({
			type: 'gpu',
			effectId: 'gpu-color-wheels',
			enabled: true,
			params: { lift: 0.25 }
		});
	});

	it('ties comparison and scope samples to explicit editor targets', () => {
		colorPreviewStore.setComparisonMode('before', ['clip-a', 'clip-b', 'clip-a']);
		colorPreviewStore.setScopeSampleItemId('sequence-output');

		expect(colorPreviewStore.comparisonMode).toBe('before');
		expect(colorPreviewStore.comparisonItemIds).toEqual(['clip-a', 'clip-b']);
		expect(colorPreviewStore.scopeSampleItemId).toBe('sequence-output');

		colorPreviewStore.setComparisonMode('after');
		expect(colorPreviewStore.comparisonItemIds).toEqual([]);
	});
});
