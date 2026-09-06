export class UnsafeSvgError extends Error {
	constructor() {
		super('SVG contains active or external content.');
		this.name = 'UnsafeSvgError';
	}
}

export async function assertSafeSvg(file: Blob): Promise<void> {
	let source = '';
	try {
		source = await file.text();
	} catch {
		throw new UnsafeSvgError();
	}
	if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw new UnsafeSvgError();
	if (
		!/<svg\b/i.test(source) ||
		/<(?:script|foreignObject|iframe|object|embed|audio|video)\b/i.test(source) ||
		/\son[a-z]+\s*=/i.test(source)
	) {
		throw new UnsafeSvgError();
	}
	for (const match of source.matchAll(/(?:href|xlink:href)\s*=\s*(['"])(.*?)\1/gi)) {
		if (!safeSvgReference(match[2]?.trim() ?? '')) throw new UnsafeSvgError();
	}
	if (unsafeSvgStyle(source)) throw new UnsafeSvgError();
	if (typeof DOMParser === 'undefined') return;
	const parser = new DOMParser();
	const document = parser.parseFromString(source, 'image/svg+xml');
	if (
		document.querySelector('parsererror') ||
		document.documentElement.localName.toLowerCase() !== 'svg' ||
		document.querySelector('script, foreignObject, iframe, object, embed, audio, video')
	) {
		throw new UnsafeSvgError();
	}
	for (const element of document.querySelectorAll('*')) {
		for (const attribute of [...element.attributes]) {
			const name = attribute.name.toLowerCase();
			const value = attribute.value.trim();
			if (name.startsWith('on')) throw new UnsafeSvgError();
			if ((name === 'href' || name.endsWith(':href')) && !safeSvgReference(value)) {
				throw new UnsafeSvgError();
			}
			if (name === 'style' && unsafeSvgStyle(value)) throw new UnsafeSvgError();
		}
	}
	for (const style of document.querySelectorAll('style')) {
		if (unsafeSvgStyle(style.textContent ?? '')) throw new UnsafeSvgError();
	}
}

function safeSvgReference(value: string): boolean {
	if (!value || value.startsWith('#')) return true;
	return /^data:image\/(?:png|jpeg|webp);base64,/i.test(value);
}

function unsafeSvgStyle(value: string): boolean {
	if (/@import/i.test(value)) return true;
	return [...value.matchAll(/url\(([^)]+)\)/gi)].some((match) => {
		const reference = match[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
		return !reference.startsWith('#');
	});
}
