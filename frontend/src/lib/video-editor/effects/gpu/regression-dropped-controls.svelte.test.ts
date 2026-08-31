/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { createGpuCompositor } from './compositor';
import { getGpuEffect } from './registry';
import type {
	GpuBooleanParamSchema,
	GpuColorParamSchema,
	GpuParamValues,
	GpuSelectParamSchema,
	GpuTextParamSchema
} from './types';

function selectDefault(schema: GpuSelectParamSchema): string {
	return schema.default;
}

function selectOptions(schema: GpuSelectParamSchema): string[] {
	return schema.options.map((option) => option.value);
}

function isSelectParam(param: { type?: string } | undefined): param is GpuSelectParamSchema {
	return param?.type === 'select';
}

function isBooleanParam(param: { type?: string } | undefined): param is GpuBooleanParamSchema {
	return param?.type === 'boolean';
}

function isColorParam(param: { type?: string } | undefined): param is GpuColorParamSchema {
	return param?.type === 'color';
}

function isTextParam(param: { type?: string } | undefined): param is GpuTextParamSchema {
	return param?.type === 'text';
}

function sourceFrame(width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable');
	const gradient = context.createLinearGradient(0, 0, width, height);
	gradient.addColorStop(0, '#102030');
	gradient.addColorStop(0.5, '#d04020');
	gradient.addColorStop(1, '#e8e0c8');
	context.fillStyle = gradient;
	context.fillRect(0, 0, width, height);
	context.fillStyle = '#2ec8a0';
	context.fillRect(width / 4, height / 4, width / 2, height / 2);
	return canvas;
}

function readPixels(canvas: HTMLCanvasElement): Uint8Array {
	const gl = canvas.getContext('webgl2');
	if (!gl) throw new Error('WebGL2 unavailable');
	const data = new Uint8Array(canvas.width * canvas.height * 4);
	gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
	return data;
}

describe('dropped-controls regression - schema parity with FreeCut 4d62e80', () => {
	it('dither restores full 10-param schema', () => {
		const dither = getGpuEffect('gpu-dither');
		expect(dither).toBeDefined();
		if (!dither) throw new Error('missing dither');
		const names = dither.schema.map((param) => param.name);
		expect(names).toEqual([
			'pattern',
			'mode',
			'style',
			'shape',
			'palette',
			'cellSize',
			'angle',
			'scale',
			'offsetX',
			'offsetY'
		]);
		const patternParam = dither.schema.find((param) => param.name === 'pattern');
		expect(patternParam).toBeDefined();
		if (!patternParam || !isSelectParam(patternParam)) throw new Error('pattern not select');
		expect(selectDefault(patternParam)).toBe('bayer4');
		expect(selectOptions(patternParam)).toEqual([
			'bayer2',
			'bayer4',
			'bayer8',
			'halftone',
			'lines',
			'crosses',
			'dots',
			'grid',
			'scales'
		]);
		const angleParam = dither.schema.find((param) => param.name === 'angle');
		expect(angleParam?.visibleWhen?.({ mode: 'linear' })).toBe(true);
		expect(angleParam?.visibleWhen?.({ mode: 'image' })).toBe(false);
		const scaleParam = dither.schema.find((param) => param.name === 'scale');
		expect(scaleParam?.visibleWhen?.({ mode: 'radial' })).toBe(true);
		expect(scaleParam?.visibleWhen?.({ mode: 'linear' })).toBe(false);
	});

	it('dither uniform mapping respects selects', () => {
		const dither = getGpuEffect('gpu-dither');
		if (!dither) throw new Error('missing dither');
		const params: GpuParamValues = {
			pattern: 'lines',
			mode: 'linear',
			style: 'scaled',
			shape: 'circle',
			palette: 'sepia',
			cellSize: 8,
			angle: 30,
			scale: 120,
			offsetX: 5,
			offsetY: -5
		};
		const uniforms = dither.uniformValues(params, 1920, 1080, 0);
		expect(uniforms.uPatternKind).toBe(4);
		expect(uniforms.uModeKind).toBe(1);
		expect(uniforms.uStyleKind).toBe(1);
		expect(uniforms.uCellKind).toBe(0);
		expect(uniforms.uPaletteKind).toBe(3);
		expect(uniforms.uAngleDeg).toBe(30);
		expect(uniforms.uScalePercent).toBe(120);
	});

	it('secondaryQualifier restores invert/show booleans', () => {
		const qualifier = getGpuEffect('gpu-secondary-qualifier');
		expect(qualifier).toBeDefined();
		if (!qualifier) throw new Error('missing qualifier');
		expect(qualifier.schema.map((param) => param.name)).toContain('invertMask');
		expect(qualifier.schema.map((param) => param.name)).toContain('showMask');
		const invertParam = qualifier.schema.find((param) => param.name === 'invertMask');
		expect(invertParam).toBeDefined();
		if (!invertParam || !isBooleanParam(invertParam)) throw new Error('invertMask not boolean');
		const paramsA: GpuParamValues = { invertMask: true, showMask: false };
		expect(qualifier.uniformValues(paramsA, 100, 100, 0).uInvertMask).toBe(1);
		const paramsB: GpuParamValues = { invertMask: false, showMask: true };
		expect(qualifier.uniformValues(paramsB, 100, 100, 0).uShowMask).toBe(1);
		expect(qualifier.uniformValues({}, 100, 100, 0).uInvertMask).toBe(0);
	});

	it('powerWindow restores shape + invert/show', () => {
		const powerWindow = getGpuEffect('gpu-power-window');
		expect(powerWindow).toBeDefined();
		if (!powerWindow) throw new Error('missing powerWindow');
		expect(powerWindow.schema.map((param) => param.name)).toEqual(
			expect.arrayContaining(['shape', 'invertMask', 'showMask'])
		);
		const shapeParam = powerWindow.schema.find((param) => param.name === 'shape');
		expect(shapeParam).toBeDefined();
		if (!shapeParam || !isSelectParam(shapeParam)) throw new Error('shape not select');
		expect(selectDefault(shapeParam)).toBe('ellipse');
		const rectParams: GpuParamValues = { shape: 'rectangle' };
		expect(powerWindow.uniformValues(rectParams, 1920, 1080, 0).uWindowKind).toBe(1);
		const ellipseParams: GpuParamValues = { shape: 'ellipse' };
		expect(powerWindow.uniformValues(ellipseParams, 1920, 1080, 0).uWindowKind).toBe(0);
		const invertParams: GpuParamValues = { invertMask: true };
		expect(powerWindow.uniformValues(invertParams, 10, 10, 0).uInvertMask).toBe(1);
		const showParams: GpuParamValues = { showMask: true };
		expect(powerWindow.uniformValues(showParams, 10, 10, 0).uShowMask).toBe(1);
	});

	it('gradientMap restores preset+customStops and legacy numeric palette compatibility', () => {
		const gradientMap = getGpuEffect('gpu-gradient-map');
		expect(gradientMap).toBeDefined();
		if (!gradientMap) throw new Error('missing gradientMap');
		const names = gradientMap.schema.map((param) => param.name);
		expect(names).toContain('preset');
		expect(names).toContain('customStops');
		expect(names).toContain('mix');
		const presetParam = gradientMap.schema.find((param) => param.name === 'preset');
		expect(presetParam).toBeDefined();
		if (!presetParam || !isSelectParam(presetParam)) throw new Error('preset not select');
		expect(selectDefault(presetParam)).toBe('inferno');
		expect(selectOptions(presetParam)).toContain('custom');
		const customParam = gradientMap.schema.find((param) => param.name === 'customStops');
		expect(customParam).toBeDefined();
		if (!customParam || !isTextParam(customParam)) throw new Error('customStops not text');
		expect(customParam.visibleWhen?.({ preset: 'custom' })).toBe(true);
		expect(customParam.visibleWhen?.({ preset: 'inferno' })).toBe(false);
		const dataTexture = gradientMap.dataTexture;
		expect(dataTexture).toBeDefined();
		if (!dataTexture) throw new Error('missing dataTexture');
		const keyCustom = dataTexture.key({ preset: 'custom', customStops: '#ff0000,#00ff00' });
		expect(keyCustom).toBe('custom:#ff0000,#00ff00');
		const keyPreset = dataTexture.key({ preset: 'inferno' });
		expect(keyPreset).toBe('preset:inferno');
		const keyLegacy = dataTexture.key({ palette: 0 });
		expect(keyLegacy).toBe('preset:inferno');
		expect(dataTexture.key({ palette: 1 })).toBe('preset:magma');
		const emptyBuild = dataTexture.build({ preset: 'custom', customStops: '' });
		expect(emptyBuild.width).toBe(256);
		expect(emptyBuild.height).toBe(1);
		expect(emptyBuild.data.length).toBe(1024);
		expect(emptyBuild.data[0]).toBe(0);
		expect(emptyBuild.data[emptyBuild.data.length - 4]).toBe(255);
		const invalidBuild = dataTexture.build({
			preset: 'custom',
			customStops: 'not-a-color, , #gggggg'
		});
		expect(invalidBuild.data.length).toBe(1024);
	});

	it('gradientMap customStops builds deterministic LUT', () => {
		const gradientMap = getGpuEffect('gpu-gradient-map');
		if (!gradientMap?.dataTexture) throw new Error('missing gradientMap');
		const dataTexture = gradientMap.dataTexture;
		const first = dataTexture.build({ preset: 'custom', customStops: '#ff0000,#00ff00' });
		const second = dataTexture.build({ preset: 'custom', customStops: '#ff0000,#00ff00' });
		expect(first.data).toEqual(second.data);
	});

	it('chromaKey restores keyColor select', () => {
		const chromaKey = getGpuEffect('gpu-chroma-key');
		expect(chromaKey).toBeDefined();
		if (!chromaKey) throw new Error('missing chromaKey');
		expect(chromaKey.schema.map((param) => param.name)).toContain('keyColor');
		const keyParam = chromaKey.schema.find((param) => param.name === 'keyColor');
		expect(keyParam).toBeDefined();
		if (!keyParam || !isSelectParam(keyParam)) throw new Error('keyColor not select');
		expect(selectDefault(keyParam)).toBe('green');
		const greenParams: GpuParamValues = { keyColor: 'green' };
		expect(chromaKey.uniformValues(greenParams, 10, 10, 0).uKeyG).toBe(1);
		const blueParams: GpuParamValues = { keyColor: 'blue' };
		expect(chromaKey.uniformValues(blueParams, 10, 10, 0).uKeyB).toBe(1);
		expect(chromaKey.uniformValues(blueParams, 10, 10, 0).uKeyG).toBe(0);
	});

	it('ink restores inkColor/paperColor', () => {
		const ink = getGpuEffect('gpu-ink');
		expect(ink).toBeDefined();
		if (!ink) throw new Error('missing ink');
		expect(ink.schema.map((param) => param.name)).toEqual(
			expect.arrayContaining(['inkColor', 'paperColor'])
		);
		const inkParam = ink.schema.find((param) => param.name === 'inkColor');
		expect(inkParam).toBeDefined();
		if (!inkParam || !isColorParam(inkParam)) throw new Error('inkColor not color');
		const defaults = ink.uniformValues({}, 1920, 1080, 0);
		expect(defaults.uInkR).toBeCloseTo(0x14 / 255, 3);
		expect(defaults.uPaperR).toBeCloseTo(0xf4 / 255, 3);
		const customParams: GpuParamValues = { inkColor: '#ff0000', paperColor: '#00ff00' };
		const custom = ink.uniformValues(customParams, 10, 10, 0);
		expect(custom.uInkR).toBeCloseTo(1, 3);
		expect(custom.uInkG).toBeCloseTo(0, 3);
		expect(custom.uPaperG).toBeCloseTo(1, 3);
	});

	it('triggerWave restores glowColor', () => {
		const triggerWave = getGpuEffect('gpu-trigger-wave');
		expect(triggerWave).toBeDefined();
		if (!triggerWave) throw new Error('missing triggerWave');
		expect(triggerWave.schema.map((param) => param.name)).toContain('glowColor');
		const glowParam = triggerWave.schema.find((param) => param.name === 'glowColor');
		expect(glowParam).toBeDefined();
		if (!glowParam || !isColorParam(glowParam)) throw new Error('glowColor not color');
		const base = triggerWave.uniformValues({}, 100, 100, 0);
		expect(base.uGlowR).toBeGreaterThan(0);
		const redParams: GpuParamValues = { glowColor: '#ff0000' };
		const red = triggerWave.uniformValues(redParams, 100, 100, 0);
		expect(red.uGlowR).toBeCloseTo(1, 3);
		expect(red.uGlowG).toBeCloseTo(0, 3);
		expect(red.uGlowB).toBeCloseTo(0, 3);
	});

	it('edgeDetect restores invert boolean', () => {
		const edgeDetect = getGpuEffect('gpu-edge-detect');
		expect(edgeDetect).toBeDefined();
		if (!edgeDetect) throw new Error('missing edgeDetect');
		expect(edgeDetect.schema.map((param) => param.name)).toContain('invert');
		const invertParam = edgeDetect.schema.find((param) => param.name === 'invert');
		expect(invertParam).toBeDefined();
		if (!invertParam || !isBooleanParam(invertParam)) throw new Error('invert not boolean');
		const trueParams: GpuParamValues = { invert: true };
		expect(edgeDetect.uniformValues(trueParams, 100, 100, 0).uInvertFlag).toBe(1);
		const falseParams: GpuParamValues = { invert: false };
		expect(edgeDetect.uniformValues(falseParams, 100, 100, 0).uInvertFlag).toBe(0);
	});

	it('mirror restores horizontal/vertical booleans', () => {
		const mirror = getGpuEffect('gpu-mirror');
		expect(mirror).toBeDefined();
		if (!mirror) throw new Error('missing mirror');
		expect(mirror.schema.map((param) => param.name)).toEqual(
			expect.arrayContaining(['horizontal', 'vertical'])
		);
		const horizontalParam = mirror.schema.find((param) => param.name === 'horizontal');
		expect(horizontalParam).toBeDefined();
		if (!horizontalParam || !isBooleanParam(horizontalParam))
			throw new Error('horizontal not boolean');
		const paramsA: GpuParamValues = { horizontal: false, vertical: true };
		expect(mirror.uniformValues(paramsA, 10, 10, 0).uHorizontal).toBe(0);
		expect(mirror.uniformValues(paramsA, 10, 10, 0).uVertical).toBe(1);
		const paramsB: GpuParamValues = { horizontal: true, vertical: false };
		expect(mirror.uniformValues(paramsB, 10, 10, 0).uHorizontal).toBe(1);
	});

	it('flutedGlass restores full 21-param schema', () => {
		const flutedGlass = getGpuEffect('gpu-fluted-glass');
		expect(flutedGlass).toBeDefined();
		if (!flutedGlass) throw new Error('missing flutedGlass');
		expect(flutedGlass.schema.length).toBe(21);
		expect(flutedGlass.schema.map((param) => param.name)).toEqual(
			expect.arrayContaining([
				'colorBack',
				'colorShadow',
				'colorHighlight',
				'shape',
				'distortionShape',
				'marginLeft',
				'marginRight',
				'marginTop',
				'marginBottom'
			])
		);
		const shapeParam = flutedGlass.schema.find((param) => param.name === 'shape');
		expect(shapeParam).toBeDefined();
		if (!shapeParam || !isSelectParam(shapeParam)) throw new Error('shape not select');
		expect(selectOptions(shapeParam)).toEqual([
			'lines',
			'linesIrregular',
			'wave',
			'zigzag',
			'pattern'
		]);
		const waveParams: GpuParamValues = { shape: 'wave' };
		expect(flutedGlass.uniformValues(waveParams, 100, 100, 0).uPatternKind).toBe(3);
		const patternParams: GpuParamValues = { shape: 'pattern' };
		expect(flutedGlass.uniformValues(patternParams, 100, 100, 0).uPatternKind).toBe(5);
		const flatParams: GpuParamValues = { distortionShape: 'flat' };
		expect(flutedGlass.uniformValues(flatParams, 100, 100, 0).uBendKind).toBe(5);
		const redParams: GpuParamValues = { colorBack: '#ff0000' };
		expect(flutedGlass.uniformValues(redParams, 100, 100, 0).uBackR).toBeCloseTo(1, 3);
		const marginParams: GpuParamValues = { margin: 0.2, marginLeft: 0.1 };
		expect(flutedGlass.uniformValues(marginParams, 100, 100, 0).uMarginLeft).toBeCloseTo(0.1, 3);
		const fallbackParams: GpuParamValues = { margin: 0.2 };
		expect(flutedGlass.uniformValues(fallbackParams, 100, 100, 0).uMarginRight).toBeCloseTo(0.2, 3);
	});

	it('rippleGlass and glassMosaic restore color params', () => {
		const rippleGlass = getGpuEffect('gpu-ripple-glass');
		expect(rippleGlass).toBeDefined();
		if (!rippleGlass) throw new Error('missing rippleGlass');
		expect(rippleGlass.schema.length).toBe(11);
		expect(rippleGlass.schema.map((param) => param.name)).toContain('colorShadow');
		const redParams: GpuParamValues = { colorShadow: '#ff0000' };
		expect(rippleGlass.uniformValues(redParams, 10, 10, 0).uShadowR).toBeCloseTo(1, 3);
		const mosaic = getGpuEffect('gpu-glass-mosaic');
		expect(mosaic).toBeDefined();
		if (!mosaic) throw new Error('missing mosaic');
		expect(mosaic.schema.length).toBe(7);
		expect(mosaic.schema.map((param) => param.name)).toContain('colorHighlight');
		const greenParams: GpuParamValues = { colorHighlight: '#00ff00' };
		expect(mosaic.uniformValues(greenParams, 10, 10, 0).uHighlightG).toBeCloseTo(1, 3);
	});

	it('pixelSort high default remains 1 (FreeCut parity) and hq separate', () => {
		const pixelSort = getGpuEffect('gpu-pixel-sort');
		const pixelSortHq = getGpuEffect('gpu-pixel-sort-hq');
		expect(pixelSort).toBeDefined();
		expect(pixelSortHq).toBeDefined();
		if (!pixelSort || !pixelSortHq) throw new Error('missing pixelSort');
		expect(pixelSort.schema.find((param) => param.name === 'high')?.default).toBe(1);
		expect(pixelSortHq.schema.find((param) => param.name === 'high')?.default).toBe(0.9);
	});

	it('preserves OpenPost IDs', () => {
		expect(getGpuEffect('gpu-dither')?.id).toBe('gpu-dither');
		expect(getGpuEffect('gpu-fluted-glass')?.id).toBe('gpu-fluted-glass');
		expect(getGpuEffect('gpu-ripple-glass')?.id).toBe('gpu-ripple-glass');
		expect(getGpuEffect('gpu-glass-mosaic')?.id).toBe('gpu-glass-mosaic');
		expect(getGpuEffect('gpu-power-window')?.id).toBe('gpu-power-window');
		expect(getGpuEffect('gpu-secondary-qualifier')?.id).toBe('gpu-secondary-qualifier');
		expect(getGpuEffect('gpu-gradient-map')?.id).toBe('gpu-gradient-map');
	});

	it('proves restored controls change pixels in Chromium WebGL2', () => {
		const width = 64;
		const height = 48;
		const source = sourceFrame(width, height);
		const output = document.createElement('canvas');
		const compositor = createGpuCompositor(output);
		expect(compositor).not.toBeNull();
		if (!compositor) return;

		const pixelsDitherA = (() => {
			const rendered = compositor.render(source, width, height, [
				{
					effectId: 'gpu-dither',
					params: {
						pattern: 'bayer2',
						mode: 'image',
						style: 'threshold',
						shape: 'square',
						palette: 'bw',
						cellSize: 8
					}
				}
			]);
			expect(rendered, compositor.failureReason() ?? undefined).toBe(true);
			return readPixels(output);
		})();

		const pixelsDitherB = (() => {
			const rendered = compositor.render(source, width, height, [
				{
					effectId: 'gpu-dither',
					params: {
						pattern: 'lines',
						mode: 'linear',
						style: 'scaled',
						shape: 'circle',
						palette: 'sepia',
						cellSize: 8,
						angle: 45,
						scale: 100,
						offsetX: 0,
						offsetY: 0
					}
				}
			]);
			expect(rendered, compositor.failureReason() ?? undefined).toBe(true);
			return readPixels(output);
		})();

		expect(pixelsDitherB).not.toEqual(pixelsDitherA);

		const pixelsWindowEllipse = (() => {
			const rendered = compositor.render(source, width, height, [
				{
					effectId: 'gpu-power-window',
					params: {
						shape: 'ellipse',
						centerX: 0.5,
						centerY: 0.5,
						sizeX: 0.6,
						sizeY: 0.4,
						rotation: 0,
						feather: 0.2,
						invertMask: false,
						showMask: false,
						exposure: 0.6,
						saturation: 0,
						temperature: 0,
						tint: 0,
						strength: 1
					}
				}
			]);
			expect(rendered, compositor.failureReason() ?? undefined).toBe(true);
			return readPixels(output);
		})();

		const pixelsWindowRectInvert = (() => {
			const rendered = compositor.render(source, width, height, [
				{
					effectId: 'gpu-power-window',
					params: {
						shape: 'rectangle',
						centerX: 0.5,
						centerY: 0.5,
						sizeX: 0.6,
						sizeY: 0.4,
						rotation: 0,
						feather: 0.2,
						invertMask: true,
						showMask: false,
						exposure: 0.6,
						saturation: 0,
						temperature: 0,
						tint: 0,
						strength: 1
					}
				}
			]);
			expect(rendered, compositor.failureReason() ?? undefined).toBe(true);
			return readPixels(output);
		})();

		expect(pixelsWindowRectInvert).not.toEqual(pixelsWindowEllipse);
		compositor.dispose();
	});
});
