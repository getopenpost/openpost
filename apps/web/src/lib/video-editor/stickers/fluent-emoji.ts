/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion -- This adapter validates bundled Iconify JSON at its fetch boundary before the UI uses it. */
import fluentEmojiCatalogUrl from '@iconify-json/fluent-emoji-flat/icons.json?url';
import type { IconifyIcon, IconifyJSON } from '@iconify/types';
import { iconToSVG } from '@iconify/utils/lib/svg/build';

export const FLUENT_EMOJI_LICENSE_URL =
	'https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE';
export const FLUENT_EMOJI_SOURCE_URL = 'https://github.com/microsoft/fluentui-emoji';
const EXPECTED_PREFIX = 'fluent-emoji-flat';
const MAX_ICON_BODY_LENGTH = 128_000;
const MAX_CATALOG_ICONS = 5_000;
const DEFAULT_STICKER_NAMES = [
	'grinning-face',
	'face-with-tears-of-joy',
	'smiling-face-with-heart-eyes',
	'face-blowing-a-kiss',
	'winking-face',
	'partying-face',
	'rolling-on-the-floor-laughing',
	'cool-button',
	'fire',
	'sparkles',
	'glowing-star',
	'party-popper',
	'confetti-ball',
	'red-heart',
	'orange-heart',
	'yellow-heart',
	'green-heart',
	'blue-heart',
	'purple-heart',
	'broken-heart',
	'heart-on-fire',
	'thumbs-up',
	'clapping-hands',
	'raised-fist',
	'flexed-biceps',
	'folded-hands',
	'victory-hand',
	'ok-hand',
	'eyes',
	'brain',
	'rocket',
	'airplane',
	'automobile',
	'bicycle',
	'trophy',
	'1st-place-medal',
	'soccer-ball',
	'basketball',
	'american-football',
	'direct-hit',
	'wrapped-gift',
	'balloon',
	'birthday-cake',
	'hot-beverage',
	'hamburger',
	'pizza',
	'avocado',
	'cherries',
	'sun',
	'rainbow',
	'cloud-with-rain',
	'lightning',
	'butterfly',
	'dog-face',
	'cat-face',
	'unicorn',
	'alien',
	'ghost',
	'robot',
	'light-bulb',
	'camera',
	'microphone',
	'headphone',
	'musical-notes'
] as const;

export interface FluentEmojiSticker {
	name: string;
	label: string;
	body: string;
	width: number;
	height: number;
	icon: IconifyIcon;
}

export interface FluentEmojiCatalog {
	stickers: readonly FluentEmojiSticker[];
	byName: ReadonlyMap<string, FluentEmojiSticker>;
}

let catalogPromise: Promise<FluentEmojiCatalog> | null = null;

function positiveDimension(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 512
		? value
		: fallback;
}

function stickerLabel(name: string): string {
	return name
		.split('-')
		.map((part) => (part === '1st' ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
		.join(' ');
}

export function parseFluentEmojiCatalog(value: unknown): FluentEmojiCatalog {
	if (!value || typeof value !== 'object') throw new Error('The sticker catalog is invalid.');
	const source = value as Partial<IconifyJSON>;
	if (source.prefix !== EXPECTED_PREFIX || !source.icons || typeof source.icons !== 'object') {
		throw new Error('The sticker catalog is invalid.');
	}
	const entries = Object.entries(source.icons);
	if (entries.length === 0 || entries.length > MAX_CATALOG_ICONS) {
		throw new Error('The sticker catalog has an invalid size.');
	}
	const defaultWidth = positiveDimension(source.width, 32);
	const defaultHeight = positiveDimension(source.height, 32);
	const stickers = entries.flatMap(([name, icon]) => {
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return [];
		if (!icon || typeof icon.body !== 'string' || icon.body.length > MAX_ICON_BODY_LENGTH)
			return [];
		return [
			{
				name,
				label: stickerLabel(name),
				body: icon.body,
				width: positiveDimension(icon.width, defaultWidth),
				height: positiveDimension(icon.height, defaultHeight),
				icon: {
					...icon,
					width: icon.width ?? defaultWidth,
					height: icon.height ?? defaultHeight
				}
			}
		];
	});
	if (stickers.length === 0) throw new Error('The sticker catalog has no usable stickers.');
	return {
		stickers,
		byName: new Map(stickers.map((sticker) => [sticker.name, sticker]))
	};
}

export async function loadFluentEmojiCatalog(
	fetcher: typeof fetch = fetch
): Promise<FluentEmojiCatalog> {
	if (!catalogPromise) {
		catalogPromise = fetcher(fluentEmojiCatalogUrl, {
			credentials: 'same-origin'
		})
			.then((response) => {
				if (!response.ok) throw new Error('The sticker catalog could not load.');
				return response.json();
			})
			.then(parseFluentEmojiCatalog)
			.catch((error) => {
				catalogPromise = null;
				throw error;
			});
	}
	return catalogPromise;
}

export function defaultFluentEmojiStickers(catalog: FluentEmojiCatalog): FluentEmojiSticker[] {
	return DEFAULT_STICKER_NAMES.flatMap((name) => {
		const sticker = catalog.byName.get(name);
		return sticker ? [sticker] : [];
	});
}

export function searchFluentEmojiStickers(
	catalog: FluentEmojiCatalog,
	query: string
): FluentEmojiSticker[] {
	const terms = query
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.map((term) => term.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
		.filter(Boolean);
	if (terms.length === 0) return defaultFluentEmojiStickers(catalog);
	return catalog.stickers
		.filter((sticker) => terms.every((term) => sticker.name.includes(term)))
		.toSorted((left, right) => {
			const leftExact = left.name === terms.join('-') ? 0 : 1;
			const rightExact = right.name === terms.join('-') ? 0 : 1;
			return leftExact - rightExact || left.name.localeCompare(right.name);
		});
}

function svgAttributes(attributes: Record<string, string | undefined>): string {
	return Object.entries(attributes)
		.filter((entry): entry is [string, string] => entry[1] !== undefined)
		.map(([name, value]) => `${name}="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`)
		.join(' ');
}

export function fluentEmojiStickerSvg(sticker: FluentEmojiSticker, size = 1024): string {
	const safeSize = Math.max(64, Math.min(2048, Math.round(size)));
	const built = iconToSVG(sticker.icon, {
		width: String(safeSize),
		height: String(safeSize)
	});
	return `<svg xmlns="http://www.w3.org/2000/svg" ${svgAttributes(built.attributes)}>${built.body}</svg>`;
}

export function fluentEmojiStickerFile(sticker: FluentEmojiSticker, size = 1024): File {
	return new File([fluentEmojiStickerSvg(sticker, size)], `sticker-${sticker.name}.svg`, {
		type: 'image/svg+xml',
		lastModified: Date.now()
	});
}

export function fluentEmojiStickerPreviewUrl(sticker: FluentEmojiSticker): string {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fluentEmojiStickerSvg(sticker, 96))}`;
}

export function fluentEmojiAttribution(sticker: FluentEmojiSticker) {
	return {
		provider: 'Fluent Emoji',
		author: 'Microsoft Corporation',
		authorUrl: FLUENT_EMOJI_SOURCE_URL,
		sourceId: sticker.name,
		license: 'MIT',
		licenseUrl: FLUENT_EMOJI_LICENSE_URL
	};
}
