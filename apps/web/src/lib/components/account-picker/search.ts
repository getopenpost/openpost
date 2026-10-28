function normalize(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

export function matchesAccountSearch(text: string, query: string): boolean {
	const searchable = normalize(text);
	return normalize(query)
		.trim()
		.split(/\s+/)
		.every((term) => searchable.includes(term));
}
