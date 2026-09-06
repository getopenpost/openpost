/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof, anti-slop/no-known-value-widening -- This module validates a recursive third-party Lottie JSON format at its byte boundary. */
/** WASM-free metadata extraction for raw Lottie JSON and dotLottie archives. */

import { unzipSync } from 'fflate';

export interface LottieMetadata {
	width: number;
	height: number;
	frameRate: number;
	totalFrames: number;
	durationSeconds: number;
	markers: LottieMarker[];
}

export interface LottieMarker {
	name: string;
	start: number;
	duration: number;
}

export interface LottieAnimationEntry {
	id: string;
}

export interface LottieManifestInfo {
	animations: LottieAnimationEntry[];
	themes: string[];
}

interface LottieJsonMarker {
	tm?: number;
	cm?: string;
	dr?: number;
}

interface LottieJson {
	w?: number;
	h?: number;
	fr?: number;
	ip?: number;
	op?: number;
	layers?: object[];
	markers?: LottieJsonMarker[];
}

function readMarkers(value: LottieJsonMarker[] | undefined): LottieMarker[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((marker) => {
		const name = marker.cm?.trim() ?? '';
		if (!name) return [];
		return [
			{
				name,
				start:
					marker.tm !== undefined && Number.isFinite(marker.tm) && marker.tm >= 0 ? marker.tm : 0,
				duration:
					marker.dr !== undefined && Number.isFinite(marker.dr) && marker.dr > 0 ? marker.dr : 0
			}
		];
	});
}

export function readLottieMarkers(animation: unknown): LottieMarker[] {
	if (!animation || typeof animation !== 'object') return [];
	return readMarkers((animation as LottieJson).markers);
}

function finitePositive(value: number | undefined): value is number {
	return value !== undefined && Number.isFinite(value) && value > 0;
}

/** Parse the timing and dimensions from a decoded Lottie animation object. */
export function parseLottieMetadata(input: unknown): LottieMetadata | null {
	if (!input || typeof input !== 'object') return null;
	const data = input as LottieJson;
	if (!Array.isArray(data.layers)) return null;

	const { w, h, fr, op } = data;
	const ip = data.ip !== undefined && Number.isFinite(data.ip) ? data.ip : 0;
	if (!finitePositive(w) || !finitePositive(h) || !finitePositive(fr) || !finitePositive(op)) {
		return null;
	}
	const totalFrames = Math.round(op - ip);
	if (totalFrames < 1) return null;
	return {
		width: Math.round(w),
		height: Math.round(h),
		frameRate: fr,
		totalFrames,
		durationSeconds: totalFrames / fr,
		markers: readMarkers(data.markers)
	};
}

function parseLottieJson(text: string): LottieMetadata | null {
	try {
		// SAFETY: parseLottieMetadata validates every field used from this external JSON boundary.
		return parseLottieMetadata(JSON.parse(text) as LottieJson);
	} catch {
		return null;
	}
}

function isZip(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 4 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		bytes[2] === 0x03 &&
		bytes[3] === 0x04
	);
}

function entryForAnimationId(entries: string[], animationId: string): string | undefined {
	const fileName = `${animationId}.json`.toLowerCase();
	return entries.find((path) => path.split('/').pop()?.toLowerCase() === fileName);
}

function animationEntries(
	files: Record<string, Uint8Array>,
	preferredAnimationId?: string
): string[] {
	const entries = Object.keys(files).filter((path) =>
		/(^|\/)(?:animations|a)\/[^/]+\.json$/i.test(path)
	);
	if (entries.length === 0) return [];
	const preferred = preferredAnimationId
		? entryForAnimationId(entries, preferredAnimationId)
		: undefined;
	if (preferred) return [preferred, ...entries.filter((path) => path !== preferred)];
	if (entries.length < 2) return entries;

	const manifestPath = Object.keys(files).find((path) => /(^|\/)manifest\.json$/i.test(path));
	if (!manifestPath) return entries;
	try {
		// SAFETY: only the optional first animation id is read after a string check.
		const manifest = JSON.parse(new TextDecoder().decode(files[manifestPath]!)) as {
			animations?: Array<{ id?: string }>;
		};
		const id = manifest.animations?.[0]?.id;
		if (!id) return entries;
		const primary = entryForAnimationId(entries, id);
		return primary ? [primary, ...entries.filter((path) => path !== primary)] : entries;
	} catch {
		return entries;
	}
}

function archiveFiles(bytes: Uint8Array): Record<string, Uint8Array> | null {
	if (!isZip(bytes)) return null;
	try {
		return unzipSync(bytes);
	} catch {
		return null;
	}
}

function lottieObject(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && Array.isArray((value as LottieJson).layers)
		? (value as Record<string, unknown>)
		: null;
}

const IMAGE_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	bmp: 'image/bmp'
};

function bytesToBase64(bytes: Uint8Array): string {
	let value = '';
	for (let index = 0; index < bytes.length; index += 0x8000) {
		value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(value);
}

function inlineArchiveImages(
	animation: Record<string, unknown>,
	files: Record<string, Uint8Array>
): void {
	if (!Array.isArray(animation.assets)) return;
	const paths = Object.keys(files);
	for (const raw of animation.assets) {
		const asset = raw as { p?: unknown; u?: unknown; e?: unknown };
		if (typeof asset.p !== 'string' || asset.p.startsWith('data:')) continue;
		const directory = typeof asset.u === 'string' ? asset.u : '';
		const candidates = [`${directory}${asset.p}`, `images/${asset.p}`, asset.p].map((path) =>
			path.toLowerCase()
		);
		const entry = paths.find((path) => {
			const lower = path.toLowerCase();
			return candidates.includes(lower) || candidates.some((value) => lower.endsWith(`/${value}`));
		});
		if (!entry) continue;
		const extension = asset.p.split('.').pop()?.toLowerCase() ?? '';
		asset.p = `data:${IMAGE_MIME[extension] ?? 'application/octet-stream'};base64,${bytesToBase64(files[entry]!)}`;
		asset.u = '';
		asset.e = 1;
	}
}

/** Extract one animation from raw JSON or a dotLottie archive. */
export function extractLottieAnimation(
	bytes: Uint8Array,
	options: { animationId?: string; inlineImages?: boolean } = {}
): Record<string, unknown> | null {
	const files = archiveFiles(bytes);
	if (!files) {
		try {
			return lottieObject(JSON.parse(new TextDecoder().decode(bytes)));
		} catch {
			return null;
		}
	}
	const decoder = new TextDecoder();
	for (const path of animationEntries(files, options.animationId)) {
		try {
			const animation = lottieObject(JSON.parse(decoder.decode(files[path]!)));
			if (!animation) continue;
			if (options.inlineImages) inlineArchiveImages(animation, files);
			return animation;
		} catch {
			// Try the next manifest entry.
		}
	}
	return null;
}

export function extractLottieManifest(bytes: Uint8Array): LottieManifestInfo | null {
	const files = archiveFiles(bytes);
	if (!files) return null;
	const manifestPath = Object.keys(files).find((path) => /(^|\/)manifest\.json$/i.test(path));
	if (!manifestPath) return null;
	try {
		const manifest = JSON.parse(new TextDecoder().decode(files[manifestPath]!)) as {
			animations?: Array<{ id?: unknown; themes?: unknown }>;
			themes?: Array<{ id?: unknown }>;
		};
		const animations: LottieAnimationEntry[] = [];
		const themes = new Set<string>();
		for (const theme of manifest.themes ?? []) {
			if (typeof theme.id === 'string' && theme.id) themes.add(theme.id);
		}
		for (const animation of manifest.animations ?? []) {
			if (typeof animation.id !== 'string' || !animation.id) continue;
			animations.push({ id: animation.id });
			if (!Array.isArray(animation.themes)) continue;
			for (const theme of animation.themes) {
				if (typeof theme === 'string' && theme) themes.add(theme);
			}
		}
		return animations.length || themes.size ? { animations, themes: [...themes] } : null;
	} catch {
		return null;
	}
}

export function extractLottieThemeData(bytes: Uint8Array, themeId: string): string | null {
	const files = archiveFiles(bytes);
	if (!files) return null;
	const suffix = `themes/${themeId}.json`.toLowerCase();
	const path = Object.keys(files).find((candidate) => {
		const lower = candidate.toLowerCase();
		return lower === suffix || lower.endsWith(`/${suffix}`);
	});
	return path ? new TextDecoder().decode(files[path]!) : null;
}

/** Parse a raw `.json` Lottie or a selected animation in a `.lottie` archive. */
export function parseLottieFileBytes(
	bytes: Uint8Array,
	animationId?: string
): LottieMetadata | null {
	if (!isZip(bytes)) {
		return parseLottieJson(new TextDecoder().decode(bytes));
	}

	const files = archiveFiles(bytes);
	if (!files) return null;
	const decoder = new TextDecoder();
	for (const path of animationEntries(files, animationId)) {
		const metadata = parseLottieJson(decoder.decode(files[path]!));
		if (metadata) return metadata;
	}
	return null;
}

export function isLottieFile(file: Pick<File, 'name' | 'type'>): boolean {
	return (
		/\.(?:json|lottie)$/i.test(file.name) ||
		file.type === 'application/json' ||
		file.type === 'application/zip'
	);
}
