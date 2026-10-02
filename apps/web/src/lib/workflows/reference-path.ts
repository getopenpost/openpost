const root = '[a-zA-Z][a-zA-Z0-9_-]*';
const component = '(?:\\.[a-zA-Z0-9_-]+|\\[(?:"(?:\\\\.|[^"\\\\])*"|[0-9]+)\\])';
const path = `${root}${component}*`;
const part = /^(?:([a-zA-Z][a-zA-Z0-9_-]*)|\.([a-zA-Z0-9_-]+)|\[("(?:\\.|[^"\\])*"|[0-9]+)\])/;

export function referenceTokens() {
	return new RegExp(`\\{\\{\\s*(${path})\\s*\\}\\}`, 'g');
}

export function wholeReferenceToken(text: string): string | undefined {
	return new RegExp(`^\\{\\{\\s*(${path})\\s*\\}\\}$`).exec(text)?.[1];
}

export function appendReferencePath(parent: string, key: string): string {
	if (/^[a-zA-Z0-9_-]+$/.test(key)) return parent ? `${parent}.${key}` : key;
	return `${parent}[${JSON.stringify(key)}]`;
}

export function referenceParts(reference: string): string[] | undefined {
	if (!new RegExp(`^${path}$`).test(reference)) {
		const parts = reference.split('.');
		if (parts.length < 2 || parts.length > 8 || !new RegExp(`^${root}$`).test(parts[0]))
			return undefined;
		return parts.every((key) => key && !['__proto__', 'constructor', 'prototype'].includes(key))
			? parts
			: undefined;
	}
	const parts: string[] = [];
	let rest = reference;
	while (rest) {
		const match = part.exec(rest);
		if (!match) return undefined;
		let key = match[1] ?? match[2] ?? match[3];
		if (match[3]?.startsWith('"')) {
			try {
				key = JSON.parse(match[3]);
			} catch {
				return undefined;
			}
		}
		if (['__proto__', 'constructor', 'prototype'].includes(key)) return undefined;
		parts.push(key);
		rest = rest.slice(match[0].length);
	}
	return parts.length <= 8 ? parts : undefined;
}
