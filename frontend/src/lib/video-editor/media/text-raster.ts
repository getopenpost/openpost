/** Shared text and subtitle rasterization for live preview and export. */

import type { TimelineItem } from '../project/types';
import {
	layoutTextBlock,
	lineInkWidth,
	type LaidOutLine,
	type TextBlockLayout
} from '../typography/text-block-layout';
import {
	applyCanvasLetterSpacing,
	createCanvasTextMeasurer,
	type TextMeasurer
} from '../typography/text-measurer';
import {
	evaluateGlyphMotion,
	getActiveTextMotionSlot,
	isTextMotionActive
} from '../timeline/text-motion-eval';
import { getTextMotionPreset } from '../timeline/text-motion-presets';
import { segmentTextUnits } from '../timeline/text-motion-segmentation';
import { parseSubtitleCueText } from '../transcript/subtitle-cue-format';
import {
	karaokeActiveBackgroundOf,
	karaokeActiveColorOf,
	karaokeStateAtFrame
} from '../transcript/karaoke';
import type { SubtitleCue } from '../project/types';

export type TextRasterContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface TextRasterFrame {
	absoluteFrame: number;
}

const SUBTITLE_LAYOUT_CACHE_LIMIT = 32;
const subtitleLayoutCache = new Map<string, TextBlockLayout>();

function styledSubtitleItem(
	text: string,
	parsed: ReturnType<typeof parseSubtitleCueText>,
	item: TimelineItem,
	width: number,
	height: number
): TimelineItem {
	const fontSize = item.fontSize ?? (height / 18) * (item.subtitleStyleScale ?? 1);
	return {
		...item,
		text: parsed.plainText,
		textSpans: parsed.spans,
		spanLayout: 'inline',
		fontFamily: item.fontFamily ?? 'Inter',
		fontSize,
		fontWeight: item.fontWeight ?? 600,
		fontStyle: item.fontStyle ?? 'normal',
		underline: item.underline ?? false,
		color: item.color ?? '#ffffff',
		backgroundFit: item.backgroundFit ?? 'content',
		textAlign: parsed.alignment?.textAlign ?? item.textAlign ?? 'center',
		verticalAlign: parsed.alignment?.verticalAlign ?? item.verticalAlign ?? 'bottom',
		lineHeight: item.lineHeight ?? 1.25,
		letterSpacing: item.letterSpacing ?? 0,
		paddingX: item.paddingX ?? width * 0.05,
		paddingY: item.paddingY ?? height * 0.05,
		textShadow: item.textShadow ?? {
			color: 'rgba(0, 0, 0, 0.9)',
			blur: fontSize / 6,
			offsetX: 0,
			offsetY: Math.max(2, fontSize / 24)
		}
	};
}

function subtitleLayoutKey(styled: TimelineItem, width: number, height: number): string {
	return JSON.stringify([
		styled.text,
		styled.textSpans,
		width,
		height,
		styled.fontFamily,
		styled.fontSize,
		styled.fontWeight,
		styled.fontStyle,
		styled.underline,
		styled.color,
		styled.backgroundFit,
		styled.textAlign,
		styled.verticalAlign,
		styled.lineHeight,
		styled.letterSpacing,
		styled.paddingX,
		styled.paddingY,
		styled.borderRadius,
		styled.textShadow,
		styled.strokeWidth,
		styled.strokeColor
	]);
}

function getCachedSubtitleLayout(
	context: TextRasterContext,
	styled: TimelineItem,
	width: number,
	height: number
): TextBlockLayout {
	const key = subtitleLayoutKey(styled, width, height);
	const cached = subtitleLayoutCache.get(key);
	if (cached) return cached;
	const layout = layoutTextBlock(styled, width, height, createCanvasTextMeasurer(context));
	subtitleLayoutCache.set(key, layout);
	if (subtitleLayoutCache.size > SUBTITLE_LAYOUT_CACHE_LIMIT) {
		const first = subtitleLayoutCache.keys().next().value;
		if (first) subtitleLayoutCache.delete(first);
	}
	return layout;
}

export function clearSubtitleLayoutCacheForTests(): void {
	subtitleLayoutCache.clear();
}

export interface KaraokeHighlightPiece {
	x: number;
	width: number;
	pieceText: string;
	run: LaidOutRun | null;
	cssFont: string;
	letterSpacing: number;
}

export interface KaraokeHighlightGeometry {
	pieces: KaraokeHighlightPiece[];
	bounds: { x: number; width: number };
}

export function getKaraokeHighlightGeometryForToken(
	line: LaidOutLine,
	tokenStart: number,
	tokenEnd: number,
	measurer: TextMeasurer
): KaraokeHighlightGeometry | null {
	if (tokenStart >= tokenEnd) return null;
	if (!line.runs || line.runs.length === 0) {
		const prefix = line.text.slice(0, tokenStart);
		const tokenText = line.text.slice(tokenStart, tokenEnd);
		const prefixWidth = prefix ? measurer.measure(prefix, line.cssFont, line.letterSpacing) : 0;
		const tokenWidth = measurer.measure(tokenText, line.cssFont, line.letterSpacing);
		const x = line.startX + prefixWidth;
		return {
			pieces: [
				{
					x,
					width: tokenWidth,
					pieceText: tokenText,
					run: null,
					cssFont: line.cssFont,
					letterSpacing: line.letterSpacing
				}
			],
			bounds: { x, width: tokenWidth }
		};
	}
	let runCharCursor = 0;
	let tokenLeft = Number.POSITIVE_INFINITY;
	let tokenRight = Number.NEGATIVE_INFINITY;
	const pieces: KaraokeHighlightPiece[] = [];
	for (const run of line.runs) {
		const runStart = runCharCursor;
		const runEnd = runStart + run.text.length;
		runCharCursor = runEnd;
		const overlapStart = Math.max(tokenStart, runStart);
		const overlapEnd = Math.min(tokenEnd, runEnd);
		if (overlapStart >= overlapEnd) continue;
		const prefixInRun = overlapStart - runStart;
		const pieceText = run.text.slice(prefixInRun, prefixInRun + (overlapEnd - overlapStart));
		const prefixInRunWidth =
			prefixInRun > 0
				? measurer.measure(run.text.slice(0, prefixInRun), run.cssFont, run.letterSpacing)
				: 0;
		const pieceWidth = measurer.measure(pieceText, run.cssFont, run.letterSpacing);
		const pieceX = line.startX + run.offsetX + prefixInRunWidth;
		pieces.push({
			x: pieceX,
			width: pieceWidth,
			pieceText,
			run,
			cssFont: run.cssFont,
			letterSpacing: run.letterSpacing
		});
		tokenLeft = Math.min(tokenLeft, pieceX);
		tokenRight = Math.max(tokenRight, pieceX + pieceWidth);
	}
	if (pieces.length === 0) return null;
	return { pieces, bounds: { x: tokenLeft, width: tokenRight - tokenLeft } };
}

export function getKaraokeTokenRangesForLine(
	line: LaidOutLine
): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	let index = 0;
	while (index < line.text.length) {
		if (/\s/.test(line.text[index]!)) {
			index += 1;
			continue;
		}
		const start = index;
		while (index < line.text.length && !/\s/.test(line.text[index]!)) index += 1;
		const end = index;
		ranges.push({ start, end });
	}
	return ranges;
}

export function renderTextItemRaster(
	context: TextRasterContext,
	item: TimelineItem,
	width: number,
	height: number,
	frame?: TextRasterFrame
): void {
	context.clearRect(0, 0, width, height);
	context.save();
	const layout = layoutTextBlock(item, width, height, createCanvasTextMeasurer(context));
	paintTextBackground(context, item, layout);
	if (item.textShadow) {
		context.shadowColor = item.textShadow.color;
		context.shadowBlur = item.textShadow.blur;
		context.shadowOffsetX = item.textShadow.offsetX;
		context.shadowOffsetY = item.textShadow.offsetY;
	}

	if (
		item.textMotion &&
		frame &&
		isTextMotionActive(item.textMotion, frame.absoluteFrame - item.from, item.durationInFrames)
	) {
		renderMotionText(context, item, layout, width, height, frame.absoluteFrame - item.from);
		context.restore();
		return;
	}
	for (const line of layout.lines) paintLaidOutLine(context, item, line);
	context.restore();
}

function paintTextBackground(
	context: TextRasterContext,
	item: TimelineItem,
	layout: TextBlockLayout
): void {
	if (!item.backgroundColor || !layout.background) return;
	const background = layout.background;
	context.fillStyle = item.backgroundColor;
	context.beginPath();
	if (background.radius > 0) {
		context.roundRect(
			background.x,
			background.y,
			background.width,
			background.height,
			background.radius
		);
	} else {
		context.rect(background.x, background.y, background.width, background.height);
	}
	context.fill();
}

function renderMotionText(
	context: TextRasterContext,
	item: TimelineItem,
	layout: TextBlockLayout,
	width: number,
	height: number,
	relativeFrame: number
): void {
	const spec = item.textMotion;
	if (!spec) return;
	const slot = getActiveTextMotionSlot(spec, relativeFrame, item.durationInFrames);
	const effect = slot ? spec[slot] : undefined;
	if (!effect) {
		for (const line of layout.lines) paintLaidOutLine(context, item, line);
		return;
	}
	const unit = effect.unit ?? getTextMotionPreset(effect.presetId).unit;
	const segmentation = segmentTextUnits(
		layout.lines.map((line) => line.text),
		unit
	);
	for (const [lineIndex, line] of layout.lines.entries()) {
		if (!line.text) continue;
		context.font = line.cssFont;
		applyCanvasLetterSpacing(context, 0);
		const runColors = line.runs?.flatMap((run) => Array.from(run.text, () => run.color));
		let currentX = line.startX;
		let characterIndex = 0;
		for (const character of line.text) {
			const glyphWidth = context.measureText(character).width;
			const unitIndex = segmentation.lineUnitIndices[lineIndex]?.[characterIndex];
			if (character !== ' ' && unitIndex !== null && unitIndex !== undefined) {
				const motion = evaluateGlyphMotion(spec, {
					relativeFrame,
					durationInFrames: item.durationInFrames,
					unitIndex,
					unitCount: segmentation.unitCount,
					fontSize: line.fontSize,
					boxWidth: width,
					boxHeight: height
				});
				if (!motion || motion.alpha > 0) {
					drawMotionGlyph(
						context,
						item,
						line,
						character,
						currentX,
						glyphWidth,
						motion,
						runColors?.[characterIndex]
					);
				}
			}
			currentX += glyphWidth + line.letterSpacing;
			characterIndex += 1;
		}
		if (line.underline) drawUnderline(context, line, line.startX, line.baselineY);
	}
}

function paintLaidOutLine(context: TextRasterContext, item: TimelineItem, line: LaidOutLine): void {
	if (!line.text) return;
	context.font = line.cssFont;
	context.textAlign = 'left';
	context.textBaseline = 'alphabetic';
	if (!line.runs?.length) {
		applyCanvasLetterSpacing(context, line.letterSpacing);
		if ((item.strokeWidth ?? 0) > 0) {
			context.strokeStyle = item.strokeColor ?? '#000000';
			context.lineWidth = (item.strokeWidth ?? 0) * 2;
			context.lineJoin = 'round';
			context.strokeText(line.text, line.startX, line.baselineY);
		}
		context.fillStyle = line.color;
		context.fillText(line.text, line.startX, line.baselineY);
		if (line.underline) drawUnderline(context, line, line.startX, line.baselineY);
		return;
	}
	for (const run of line.runs) {
		context.font = run.cssFont;
		applyCanvasLetterSpacing(context, run.letterSpacing);
		if ((item.strokeWidth ?? 0) > 0) {
			context.strokeStyle = item.strokeColor ?? '#000000';
			context.lineWidth = (item.strokeWidth ?? 0) * 2;
			context.lineJoin = 'round';
			context.strokeText(run.text, line.startX + run.offsetX, line.baselineY);
		}
		context.fillStyle = run.color;
		context.fillText(run.text, line.startX + run.offsetX, line.baselineY);
		if (run.underline) {
			drawUnderline(
				context,
				{
					...line,
					cssFont: run.cssFont,
					fontSize: run.fontSize,
					letterSpacing: run.letterSpacing,
					trailingLetterSpacing: run.letterSpacing,
					width: run.width,
					color: run.color
				},
				line.startX + run.offsetX,
				line.baselineY
			);
		}
	}
}

function drawMotionGlyph(
	context: TextRasterContext,
	item: TimelineItem,
	line: LaidOutLine,
	character: string,
	x: number,
	advance: number,
	motion: ReturnType<typeof evaluateGlyphMotion>,
	color?: string
): void {
	context.save();
	if (motion) {
		const centerX = x + advance / 2;
		const centerY = line.baselineY - line.fontSize * 0.3;
		context.translate(motion.dx, motion.dy);
		context.translate(centerX, centerY);
		if (motion.rotation !== 0) context.rotate(motion.rotation);
		if (motion.scale !== 1) context.scale(motion.scale, motion.scale);
		context.translate(-centerX, -centerY);
		context.globalAlpha *= motion.alpha;
		if (motion.soften > 0) context.filter = `blur(${motion.soften}px)`;
	}
	context.font = line.cssFont;
	context.textAlign = 'left';
	context.textBaseline = 'alphabetic';
	context.fillStyle = color ?? line.color;
	if ((item.strokeWidth ?? 0) > 0) {
		context.strokeStyle = item.strokeColor ?? '#000000';
		context.lineWidth = (item.strokeWidth ?? 0) * 2;
		context.lineJoin = 'round';
		context.strokeText(character, x, line.baselineY);
	}
	context.fillText(character, x, line.baselineY);
	context.restore();
}

function drawUnderline(
	context: TextRasterContext,
	line: LaidOutLine,
	x: number,
	baselineY: number
): void {
	const thickness = Math.max(1, line.fontSize * 0.055);
	context.fillStyle = line.color;
	context.fillRect(x, baselineY + Math.max(1, line.fontSize * 0.08), lineInkWidth(line), thickness);
}

export function renderSubtitleRaster(
	context: TextRasterContext,
	text: string,
	item: TimelineItem,
	width: number,
	height: number
): void {
	const parsed = parseSubtitleCueText(text);
	const styledCue = styledSubtitleItem(text, parsed, item, width, height);
	renderTextItemRaster(context, styledCue, width, height);
}

export function renderSubtitleCueRaster(
	context: TextRasterContext,
	cue: SubtitleCue,
	item: TimelineItem,
	width: number,
	height: number,
	frame: number
): void {
	const parsed = parseSubtitleCueText(cue.text);
	const styledCue = styledSubtitleItem(cue.text, parsed, item, width, height);
	// Karaoke highlight is functional caption state, not decorative motion – keep
	// identical active-word state for preview and export even under reduced motion.
	const karaokeState = karaokeStateAtFrame(item, cue, parsed.plainText, frame);
	if (!karaokeState) {
		context.clearRect(0, 0, width, height);
		context.save();
		const layout = getCachedSubtitleLayout(context, styledCue, width, height);
		paintTextBackground(context, styledCue, layout);
		if (styledCue.textShadow) {
			context.shadowColor = styledCue.textShadow.color;
			context.shadowBlur = styledCue.textShadow.blur;
			context.shadowOffsetX = styledCue.textShadow.offsetX;
			context.shadowOffsetY = styledCue.textShadow.offsetY;
		}
		for (const line of layout.lines) paintLaidOutLine(context, styledCue, line);
		context.restore();
		return;
	}
	context.clearRect(0, 0, width, height);
	context.save();
	const layout = getCachedSubtitleLayout(context, styledCue, width, height);
	paintTextBackground(context, styledCue, layout);
	if (styledCue.textShadow) {
		context.shadowColor = styledCue.textShadow.color;
		context.shadowBlur = styledCue.textShadow.blur;
		context.shadowOffsetX = styledCue.textShadow.offsetX;
		context.shadowOffsetY = styledCue.textShadow.offsetY;
	}
	for (const line of layout.lines) paintLaidOutLine(context, styledCue, line);
	paintKaraokeHighlight(
		context,
		styledCue,
		layout,
		karaokeState.activeIndex,
		karaokeActiveColorOf(item),
		karaokeActiveBackgroundOf(item)
	);
	context.restore();
}

function paintKaraokeHighlight(
	context: TextRasterContext,
	item: TimelineItem,
	layout: TextBlockLayout,
	activeIndex: number,
	activeColor: string,
	activeBackground: string | undefined
): void {
	let globalTokenIndex = 0;
	const measurer = createCanvasTextMeasurer(context);
	for (const line of layout.lines) {
		if (!line.text) continue;
		const tokenRanges = getKaraokeTokenRangesForLine(line);
		if (tokenRanges.length === 0) continue;
		for (let tokenPosition = 0; tokenPosition < tokenRanges.length; tokenPosition += 1) {
			if (globalTokenIndex !== activeIndex) {
				globalTokenIndex += 1;
				continue;
			}
			const tokenRange = tokenRanges[tokenPosition]!;
			const geometry = getKaraokeHighlightGeometryForToken(
				line,
				tokenRange.start,
				tokenRange.end,
				measurer
			);
			if (!geometry) return;
			const { bounds, pieces } = geometry;
			if (activeBackground) {
				context.save();
				context.shadowColor = 'transparent';
				context.shadowBlur = 0;
				context.shadowOffsetX = 0;
				context.shadowOffsetY = 0;
				const padX = Math.max(2, line.fontSize * 0.08);
				const padY = Math.max(1, line.fontSize * 0.06);
				context.fillStyle = activeBackground;
				context.fillRect(
					bounds.x - padX,
					line.top + padY,
					bounds.width + padX * 2,
					line.lineHeightPx - padY * 2
				);
				context.restore();
			}
			for (const piece of pieces) {
				context.save();
				context.font = piece.cssFont;
				applyCanvasLetterSpacing(context, piece.letterSpacing);
				context.textAlign = 'left';
				context.textBaseline = 'alphabetic';
				if (item.textShadow) {
					context.shadowColor = item.textShadow.color;
					context.shadowBlur = item.textShadow.blur;
					context.shadowOffsetX = item.textShadow.offsetX;
					context.shadowOffsetY = item.textShadow.offsetY;
				}
				if ((item.strokeWidth ?? 0) > 0) {
					context.strokeStyle = item.strokeColor ?? '#000000';
					context.lineWidth = (item.strokeWidth ?? 0) * 2;
					context.lineJoin = 'round';
					context.strokeText(piece.pieceText, piece.x, line.baselineY);
				}
				context.fillStyle = activeColor;
				context.fillText(piece.pieceText, piece.x, line.baselineY);
				context.restore();
			}
			return;
		}
	}
}
