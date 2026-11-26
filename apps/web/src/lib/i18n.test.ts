import { describe, expect, it } from 'vitest';
import { offlineTranslations } from './offline-translations';
import { getLocaleRegion, getLocaleTag, localeLabels } from './i18n';
import { getTextDirection } from './paraglide/runtime';

describe('Arabic locale formatting', () => {
	it('formats Arabic with Arabic month names, Western digits, valid region fallback and RTL direction', () => {
		const locale = getLocaleTag('ar');
		expect(localeLabels.ar).toBe('العربية');
		expect(getLocaleRegion('ar')).toBe('US');
		expect(getLocaleRegion('pt-BR')).toBe('BR');
		expect(getTextDirection('ar')).toBe('rtl');
		expect(getTextDirection('en')).toBe('ltr');
		expect(new Intl.NumberFormat(locale).format(12345.6)).toBe('12,345.6');
		expect(
			new Intl.DateTimeFormat(locale, {
				day: 'numeric',
				month: 'long',
				year: 'numeric',
				timeZone: 'UTC'
			}).formatToParts(new Date('2026-10-14T12:00:00Z'))
		).toEqual(
			expect.arrayContaining([
				{ type: 'day', value: '14' },
				{ type: 'month', value: 'أكتوبر' },
				{ type: 'year', value: '2026' }
			])
		);
		expect(offlineTranslations.ar[2]).toBe('إعادة المحاولة');
	});
});
