export interface LocalAiRuntimeController {
	id: string;
	label: string;
	isLoaded: () => boolean;
	unload: () => Promise<void> | void;
}

export interface LocalAiRuntimeSummary {
	id: string;
	label: string;
	loaded: boolean;
}

export interface LocalAiRuntimeUnloadResult {
	unloadedIds: string[];
	failures: Array<{ id: string; error: unknown }>;
}

export class LocalAiRuntimeRegistry {
	private readonly controllers = new Map<string, LocalAiRuntimeController>();

	constructor(private readonly unloadTimeoutMs = 10_000) {}

	private async unloadController(controller: LocalAiRuntimeController): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				Promise.resolve(controller.unload()),
				new Promise<void>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error(`${controller.label} did not unload in time`)),
						this.unloadTimeoutMs
					);
				})
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	register(controller: LocalAiRuntimeController): () => void {
		this.controllers.set(controller.id, controller);
		return () => {
			if (this.controllers.get(controller.id) === controller) {
				this.controllers.delete(controller.id);
			}
		};
	}

	inspect(): LocalAiRuntimeSummary[] {
		return [...this.controllers.values()]
			.map((controller) => ({
				id: controller.id,
				label: controller.label,
				loaded: controller.isLoaded()
			}))
			.toSorted((left, right) => left.label.localeCompare(right.label));
	}

	async unload(id: string): Promise<boolean> {
		const controller = this.controllers.get(id);
		if (!controller?.isLoaded()) return false;
		await this.unloadController(controller);
		return true;
	}

	async unloadAll(): Promise<LocalAiRuntimeUnloadResult> {
		const loaded = [...this.controllers.values()].filter((controller) => controller.isLoaded());
		const results = await Promise.allSettled(
			loaded.map(async (controller) => {
				await this.unloadController(controller);
				return controller.id;
			})
		);
		const unloadedIds: string[] = [];
		const failures: LocalAiRuntimeUnloadResult['failures'] = [];
		for (const [index, result] of results.entries()) {
			const controller = loaded[index]!;
			if (result.status === 'fulfilled') unloadedIds.push(result.value);
			else failures.push({ id: controller.id, error: result.reason });
		}
		return { unloadedIds, failures };
	}
}

export const localAiRuntimeRegistry = new LocalAiRuntimeRegistry();

export function inspectLocalAiRuntimes(): LocalAiRuntimeSummary[] {
	return localAiRuntimeRegistry.inspect();
}

export function unloadLocalAiRuntime(id: string): Promise<boolean> {
	return localAiRuntimeRegistry.unload(id);
}

export function unloadAllLocalAiRuntimes(): Promise<LocalAiRuntimeUnloadResult> {
	return localAiRuntimeRegistry.unloadAll();
}
