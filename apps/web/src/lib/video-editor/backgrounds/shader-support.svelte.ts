import { ShaderBackgroundRenderer } from './shader-renderer';
import { SHADER_PRESETS } from './shaders';

let available = $state<boolean | undefined>();

/** Share the same insertion capability across the gallery and inspector. */
export const shaderBackgroundSupport = {
	get available(): boolean {
		return available === true;
	},
	check(): boolean {
		if (available !== undefined) return available;
		let renderer: ShaderBackgroundRenderer | undefined;
		try {
			renderer = new ShaderBackgroundRenderer();
			for (const preset of SHADER_PRESETS) renderer.render(preset.background, 2, 2, 0);
			available = true;
		} catch {
			available = false;
		} finally {
			renderer?.dispose();
		}
		return available;
	},
	reportFailure(): void {
		available = false;
	}
};
