import {
	getLocale,
	getTextDirection,
	isLocale,
	setLocale,
	type Locale
} from '$lib/paraglide/runtime';

const LOCALE_CHANGED_EVENT = 'openpost:locale-changed';

export const localeLabels = {
	en: 'English',
	es: 'Español',
	fr: 'Français',
	de: 'Deutsch',
	it: 'Italiano',
	ru: 'Русский',
	pt: 'Português',
	'pt-BR': 'Português do Brasil',
	tr: 'Türkçe',
	ja: '日本語',
	ko: '한국어',
	zh: '简体中文',
	ar: 'العربية'
} satisfies Record<Locale, string>;

export function getCurrentLocale(): Locale {
	return getLocale();
}

export function getLocaleTag(locale: Locale = getCurrentLocale()): string {
	switch (locale) {
		case 'es':
			return 'es-ES';
		case 'fr':
			return 'fr-FR';
		case 'de':
			return 'de-DE';
		case 'ru':
			return 'ru-RU';
		case 'it':
			return 'it-IT';
		case 'pt':
			return 'pt-PT';
		case 'pt-BR':
			return 'pt-BR';
		case 'tr':
			return 'tr-TR';
		case 'ja':
			return 'ja-JP';
		case 'ko':
			return 'ko-KR';
		case 'zh':
			return 'zh-CN';
		case 'ar':
			return 'ar-u-nu-latn';
		case 'en':
		default:
			return 'en-US';
	}
}

export function getLocaleRegion(locale: Locale = getCurrentLocale()): string {
	return new Intl.Locale(getLocaleTag(locale)).region ?? 'US';
}

function announceLocaleChange(locale: Locale) {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent<Locale>(LOCALE_CHANGED_EVENT, { detail: locale }));
}

function applyDocumentLocale(locale: Locale) {
	if (typeof document === 'undefined') return;
	document.documentElement.lang = locale;
	document.documentElement.dir = getTextDirection(locale);
}

export function switchLocale(locale: Locale, options?: { reload?: boolean }) {
	applyDocumentLocale(locale);
	const result = setLocale(locale, options);
	if (result instanceof Promise) {
		return result.then(() => announceLocaleChange(locale));
	}
	announceLocaleChange(locale);
}

export function onLocaleChange(listener: (locale: Locale) => void): () => void {
	if (typeof window === 'undefined') return () => undefined;
	const handleLocaleChange = (event: Event) => {
		if (event instanceof CustomEvent && isLocale(event.detail)) listener(event.detail);
	};
	window.addEventListener(LOCALE_CHANGED_EVENT, handleLocaleChange);
	return () => window.removeEventListener(LOCALE_CHANGED_EVENT, handleLocaleChange);
}
