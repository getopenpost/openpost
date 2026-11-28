export function downloadScreenshot(blob: Blob, title: string, extension = 'png'): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = screenshotFilename(title).replace(/\.png$/, `.${extension}`);
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function screenshotFilename(title: string): string {
	return `${
		title
			.trim()
			.replace(/[^\p{L}\p{N}_. -]/gu, '')
			.slice(0, 100) || 'template'
	}.png`;
}
