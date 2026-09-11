import type { BackgroundShader } from '../project/types';
import { ShaderBackgroundRenderer } from './shader-renderer';

let available = $state<boolean | undefined>();
let failed = $state<BackgroundShader[]>([]);

/** Share the same insertion capability across the gallery and inspector. */
export const shaderBackgroundSupport = {
	get available(): boolean {
		return available === true;
	},
	isAvailable(shader: BackgroundShader): boolean {
		return available === true && !failed.includes(shader);
	},
	check(): boolean {
		if (available !== undefined) return available;
		let renderer: ShaderBackgroundRenderer | undefined;
		try {
			renderer = new ShaderBackgroundRenderer();
			available = true;
		} catch {
			available = false;
		} finally {
			renderer?.dispose();
		}
		return available;
	},
	reportFailure(shader: BackgroundShader): void {
		if (!failed.includes(shader)) failed = [...failed, shader];
	}
};
