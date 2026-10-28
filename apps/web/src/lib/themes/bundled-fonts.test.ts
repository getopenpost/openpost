import { describe, expect, it } from 'vitest';
import { isAvailableThemeFontFamily } from '@openpost/ui/themes/bundled-fonts.js';

describe('bundled theme fonts', () => {
	it('allows a bundled family or a family backed by an uploaded face', () => {
		expect(isAvailableThemeFontFamily('Geist Variable', [])).toBe(true);
		expect(
			isAvailableThemeFontFamily('Organization Sans', [
				{
					id: 'organization-sans-400',
					family: 'Organization Sans',
					sourceUrl: '/api/v1/theme-assets/opaque-id/content?organization_id=organization-id',
					format: 'woff2',
					weight: 400,
					style: 'normal',
					display: 'swap'
				}
			])
		).toBe(true);
		expect(isAvailableThemeFontFamily('Unapproved Remote Font', [])).toBe(false);
	});
});
