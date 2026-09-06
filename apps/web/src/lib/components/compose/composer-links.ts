const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:\])}]+$/u;

function trimTrailingPunctuation(value: string): string {
	return value.replace(TRAILING_PUNCTUATION, '');
}

export function firstComposerURL(value: string): string {
	for (const match of value.matchAll(URL_PATTERN)) {
		const url = trimTrailingPunctuation(match[0]);
		if (url) return url;
	}
	return '';
}
