function sanitizeFilenamePart(value: string, fallback: string): string {
	return (
		value
			.toLowerCase()
			.trim()
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || fallback
	);
}

export function imageEditorPageFilename(
	designTitle: string,
	pageName: string,
	pageIndex: number,
	extension: string
): string {
	const title = sanitizeFilenamePart(designTitle, 'openpost-design');
	const number = String(pageIndex + 1).padStart(2, '0');
	const genericName = /^page\s+\d+$/i.test(pageName.trim());
	const page = genericName
		? `page-${number}`
		: `${number}-${sanitizeFilenamePart(pageName, 'page')}`;
	return `${title}-${page}.${extension}`;
}

export function imageEditorArchiveFilename(designTitle: string): string {
	return `${sanitizeFilenamePart(designTitle, 'openpost-design')}.zip`;
}
