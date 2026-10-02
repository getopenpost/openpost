import type { IText, Path } from 'fabric';
import { getAuthenticatedMediaURL } from '$lib/media-url';
import { registeredEditorFontSources } from '$lib/editor-fonts';
import { imageEditorTextFontFamily, loadImageEditorTextFont } from './fonts';
import { textGraphemes, textRunStyleAt } from './text-runs';
import type { ImageEditorTextValue } from './types';
import { IMAGE_EDITOR_EXPORT_WORKING_MEMORY_LIMIT } from './export-budget';
import { m } from '$lib/paraglide/messages';

const SVG_NS = 'http://www.w3.org/2000/svg';
const fontSources = new Map<string | Blob, Promise<string>>();

async function embeddedFont(source: string | Blob): Promise<string> {
	let pending = fontSources.get(source);
	if (!pending) {
		pending = (async () => {
			let blob: Blob;
			if (source instanceof Blob) blob = source;
			else {
				const response = await fetch(source, { credentials: 'include' });
				if (!response.ok) throw new Error(m.image_editor_project_media_failed());
				blob = await response.blob();
			}
			return new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result));
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(blob);
			});
		})();
		fontSources.set(source, pending);
		pending.catch(() => fontSources.delete(source));
	}
	return pending;
}

async function fontCSS(text: ImageEditorTextValue): Promise<string> {
	const family = imageEditorTextFontFamily(text);
	if (text.font_asset_id) {
		await loadImageEditorTextFont(text);
		const source = getAuthenticatedMediaURL(`/media/${encodeURIComponent(text.font_asset_id)}`);
		return `@font-face{font-family:${JSON.stringify(family)};src:url("${await embeddedFont(source)}");font-weight:${text.font_weight};font-style:${text.font_style}}`;
	}
	const registered = await Promise.all(
		registeredEditorFontSources(family).map(
			async (face) =>
				`@font-face{font-family:${JSON.stringify(face.family)};src:url("${await embeddedFont(face.source)}");font-weight:${face.weight};font-style:${face.style}}`
		)
	);
	const faces: CSSFontFaceRule[] = [];
	const collect = (rules: CSSRuleList) => {
		for (const rule of rules) {
			if (rule instanceof CSSFontFaceRule) {
				const candidate = rule.style.getPropertyValue('font-family').replace(/^['"]|['"]$/g, '');
				if (candidate === family) faces.push(rule);
			} else if (rule instanceof CSSImportRule && rule.styleSheet) {
				collect(rule.styleSheet.cssRules);
			} else if (rule instanceof CSSGroupingRule) {
				collect(rule.cssRules);
			}
		}
	};
	for (const sheet of document.styleSheets) {
		// Cross-origin sheets cannot provide an embeddable application font source.
		try {
			collect(sheet.cssRules);
		} catch {
			/* Browser access restriction. */
		}
	}
	return (
		await Promise.all(
			faces.map(async (face) => {
				const source = face.style.getPropertyValue('src');
				const urls = [...source.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)];
				let embedded = source;
				for (const match of urls) {
					const url = new URL(match[1], face.parentStyleSheet?.href || document.baseURI).href;
					embedded = embedded.replace(match[0], `url("${await embeddedFont(url)}")`);
				}
				return face.cssText.replace(source, embedded);
			})
		)
	)
		.concat(registered)
		.join('\n');
}

function reversedPath(path: Path['path']): string {
	const segments: string[] = [];
	let x = 0,
		y = 0;
	for (const command of path) {
		if (command[0] === 'M') {
			x = command[1];
			y = command[2];
			continue;
		}
		switch (command[0]) {
			case 'L':
				segments.unshift(`L ${x} ${y}`);
				x = command[1];
				y = command[2];
				break;
			case 'Q':
				segments.unshift(`Q ${command[1]} ${command[2]} ${x} ${y}`);
				x = command[3];
				y = command[4];
				break;
			case 'C':
				segments.unshift(`C ${command[3]} ${command[4]} ${command[1]} ${command[2]} ${x} ${y}`);
				x = command[5];
				y = command[6];
				break;
			default:
				throw new Error(m.image_editor_page_render_failed());
		}
	}
	return `M ${x} ${y} ${segments.join(' ')}`;
}

/** Native textPath shapes complete bidi and ligature runs instead of Fabric's per-grapheme drawing. */
export async function renderCurvedText(
	text: ImageEditorTextValue,
	object: IText,
	options: { onMissingFont(assetID: string): void }
): Promise<{
	image: HTMLImageElement;
	left: number;
	top: number;
	width: number;
	height: number;
}> {
	const path = object.path!;
	const padding = text.font_size + text.stroke_width;
	const width = Math.ceil(object.width + padding * 2);
	const height = Math.ceil(object.height + padding * 2);
	if (width * height * 4 > IMAGE_EDITOR_EXPORT_WORKING_MEMORY_LIMIT) {
		throw new Error(m.image_editor_export_budget_exceeded());
	}
	const left = -object.width / 2 - padding;
	const top = -object.height / 2 - padding;
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('width', String(width));
	svg.setAttribute('height', String(height));
	svg.setAttribute(
		'viewBox',
		`${path.pathOffset.x + left} ${path.pathOffset.y + top} ${width} ${height}`
	);
	const style = document.createElementNS(SVG_NS, 'style');
	let renderText = text;
	try {
		style.textContent = await fontCSS(renderText);
	} catch (error) {
		if (!text.font_asset_id) throw error;
		options.onMissingFont(text.font_asset_id);
		renderText = { ...text, font_asset_id: undefined };
		style.textContent = await fontCSS(renderText);
	}
	svg.append(style);
	const defs = document.createElementNS(SVG_NS, 'defs');
	const svgPath = document.createElementNS(SVG_NS, 'path');
	svgPath.id = 'curve';
	const pathData = text.curve?.reverse
		? reversedPath(path.path)
		: path.path.map((command) => command.join(' ')).join(' ');
	const length = path.segmentsInfo!.at(-1)!.length;
	// Repeated subpaths retain the editor's wrap-around offsets and long text behavior.
	const repetitions = Math.ceil(object.calcTextWidth() / length) + 3;
	svgPath.setAttribute('d', Array.from({ length: repetitions }, () => pathData).join(' '));
	defs.append(svgPath);
	svg.append(defs);
	const node = document.createElementNS(SVG_NS, 'text');
	node.style.fontFamily = imageEditorTextFontFamily(renderText);
	node.style.fontWeight = String(text.font_weight);
	node.style.fontStyle = text.font_style;
	node.style.fontSize = `${text.font_size}px`;
	node.style.letterSpacing = `${(text.letter_spacing * text.font_size) / 100}px`;
	node.setAttribute('fill', text.color);
	node.setAttribute('stroke', text.stroke_color || 'none');
	node.setAttribute('stroke-width', String(text.stroke_width));
	node.setAttribute('paint-order', 'fill stroke');
	node.setAttribute('dominant-baseline', 'central');
	node.style.whiteSpace = 'pre';
	const decoration = [text.underline && 'underline', text.strike && 'line-through']
		.filter(Boolean)
		.join(' ');
	node.style.textDecoration = decoration;
	const textPath = document.createElementNS(SVG_NS, 'textPath');
	textPath.setAttribute('href', '#curve');
	const anchor = text.align === 'center' ? 'middle' : text.align === 'right' ? 'end' : 'start';
	node.setAttribute('text-anchor', anchor);
	const aligned = text.align === 'center' ? length / 2 : text.align === 'right' ? length : 0;
	const offset = object.pathStartOffset;
	textPath.setAttribute(
		'startOffset',
		String(length + ((((aligned + offset) % length) + length) % length))
	);
	const graphemes = textGraphemes(text.text.replace(/\r\n?|\n/g, ' '));
	let current: SVGTSpanElement | undefined;
	let previousStyle = '';
	let contents = '';
	for (let index = 0; index < graphemes.length; index++) {
		const run = textRunStyleAt(text, index);
		const key = JSON.stringify(run);
		if (!current || key !== previousStyle) {
			if (current) current.textContent = contents;
			contents = '';
			current = document.createElementNS(SVG_NS, 'tspan');
			if (run.font_weight !== undefined) current.style.fontWeight = String(run.font_weight);
			if (run.font_style !== undefined) current.style.fontStyle = run.font_style;
			if (run.color !== undefined) current.setAttribute('fill', run.color);
			if (run.underline !== undefined)
				current.style.textDecoration = [run.underline && 'underline', text.strike && 'line-through']
					.filter(Boolean)
					.join(' ');
			textPath.append(current);
			previousStyle = key;
		}
		contents += graphemes[index];
	}
	if (current) current.textContent = contents;
	node.append(textPath);
	svg.append(node);
	const url = URL.createObjectURL(
		new Blob([new XMLSerializer().serializeToString(svg)], {
			type: 'image/svg+xml'
		})
	);
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		return { image, left, top, width, height };
	} finally {
		URL.revokeObjectURL(url);
	}
}
