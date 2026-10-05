const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
function trimTrailingPunctuation(value: string): string {
	while (value) {
		const last = value.at(-1)!;
		if (
			'.,;:!?]}'.includes(last) ||
			(last === ')' && value.split(')').length > value.split('(').length)
		) {
			value = value.slice(0, -1);
		} else break;
	}
	return value;
}

export function firstComposerURL(value: string): string {
	for (const match of value.matchAll(URL_PATTERN)) {
		const url = trimTrailingPunctuation(match[0]);
		try {
			const parsed = new URL(url);
			if (parsed.hostname && ['http:', 'https:'].includes(parsed.protocol)) return url;
		} catch {
			continue;
		}
	}
	return '';
}
