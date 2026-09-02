import type { WebResolvedTheme } from './contracts.js';
import { createBrowserThemeRuntimeLoaders, WebThemeRuntime } from './runtime.js';

const previewSource = `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<style>
			html, body { min-height: 100%; margin: 0; }
			body { min-width: 0; }
			[data-theme-preview-root] { min-height: 100%; isolation: isolate; }
		</style>
	</head>
	<body>
		<div data-theme-preview-root></div>
		<div data-theme-preview-portals></div>
	</body>
</html>`;

export interface ThemePreviewDocument {
	document: Document;
	root: HTMLElement;
	portalTarget: HTMLElement;
	portalProps: Readonly<{ to: HTMLElement }>;
	apply(theme: WebResolvedTheme): Promise<boolean>;
	clear(): void;
	destroy(): void;
}

export interface ThemePreviewDocumentOptions {
	styleSource?: Document;
	runtime?: WebThemeRuntime;
}

function waitForFrameLoad(frame: HTMLIFrameElement): Promise<void> {
	return new Promise((resolve) => {
		frame.addEventListener('load', () => resolve(), { once: true });
		frame.srcdoc = previewSource;
	});
}

async function copyStyles(source: Document, target: Document): Promise<void> {
	const pending: Promise<void>[] = [];
	for (const node of source.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
		'style, link[rel="stylesheet"]'
	)) {
		if (node instanceof HTMLStyleElement) {
			const style = target.createElement('style');
			style.textContent = node.textContent;
			target.head.append(style);
			continue;
		}
		if (node.disabled || !node.href) continue;
		const link = target.createElement('link');
		link.rel = 'stylesheet';
		link.href = node.href;
		link.media = node.media;
		if (node.crossOrigin) link.crossOrigin = node.crossOrigin;
		if (node.integrity) link.integrity = node.integrity;
		pending.push(
			new Promise((resolve, reject) => {
				link.addEventListener('load', () => resolve(), { once: true });
				link.addEventListener(
					'error',
					() => reject(new Error(`Could not load preview stylesheet ${link.href}`)),
					{ once: true }
				);
			})
		);
		target.head.append(link);
	}
	await Promise.all(pending);
}

export async function mountThemePreviewDocument(
	frame: HTMLIFrameElement,
	theme: WebResolvedTheme,
	options: ThemePreviewDocumentOptions = {}
): Promise<ThemePreviewDocument> {
	frame.setAttribute('sandbox', 'allow-same-origin');
	frame.referrerPolicy = 'no-referrer';
	await waitForFrameLoad(frame);
	const targetDocument = frame.contentDocument;
	if (!targetDocument) throw new Error('Theme preview document is unavailable');
	await copyStyles(options.styleSource ?? frame.ownerDocument, targetDocument);

	const root = targetDocument.querySelector<HTMLElement>('[data-theme-preview-root]');
	const portalTarget = targetDocument.querySelector<HTMLElement>('[data-theme-preview-portals]');
	if (!root || !portalTarget) throw new Error('Theme preview mount points are unavailable');

	const runtime =
		options.runtime ?? new WebThemeRuntime(createBrowserThemeRuntimeLoaders(targetDocument));
	await runtime.applyScoped(theme, targetDocument.documentElement);
	let destroyed = false;
	const boundary: ThemePreviewDocument = {
		document: targetDocument,
		root,
		portalTarget,
		portalProps: { to: portalTarget },
		apply(nextTheme) {
			if (destroyed) return Promise.resolve(false);
			return runtime.applyScoped(nextTheme, targetDocument.documentElement);
		},
		clear() {
			if (!destroyed) runtime.clear(targetDocument.documentElement);
		},
		destroy() {
			if (destroyed) return;
			runtime.clear(targetDocument.documentElement);
			root.replaceChildren();
			portalTarget.replaceChildren();
			destroyed = true;
		}
	};
	return boundary;
}
