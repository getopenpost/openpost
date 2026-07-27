import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime';

export const localeLabels: Record<Locale, string> = {
	en: 'English',
	pt: 'Português'
};

export function getCurrentLocale(): Locale {
	return getLocale();
}

export function getLocaleTag(locale: Locale = getCurrentLocale()): string {
	switch (locale) {
		case 'pt':
			return 'pt-PT';
		case 'en':
		default:
			return 'en-US';
	}
}

export function switchLocale(locale: Locale) {
	return setLocale(locale);
}
