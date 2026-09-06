<script lang="ts">
	import { ProtectedIcon, ThemeIcon, type ProtectedIconRole } from '$lib/themes/icons';
	import type { ThemeIconRole } from '$lib/themes';

	export type EditorWorkspaceOption = {
		id: string;
		label: string;
		emblem: { kind: 'protected'; role: ProtectedIconRole } | { kind: 'theme'; role: ThemeIconRole };
	};

	let {
		value,
		options,
		ariaLabel,
		idPrefix,
		panelId,
		onvaluechange
	}: {
		value: string;
		options: EditorWorkspaceOption[];
		ariaLabel: string;
		idPrefix: string;
		panelId?: string;
		onvaluechange: (workspace: string) => void;
	} = $props();

	function focusWorkspace(index: number): void {
		const workspace = options[index];
		if (!workspace) return;
		selectWorkspace(workspace.id);
		requestAnimationFrame(() => {
			document.getElementById(`${idPrefix}-${workspace.id}`)?.focus();
		});
	}

	function selectWorkspace(workspace: string): void {
		onvaluechange(workspace);
	}

	function handleKeydown(event: KeyboardEvent, index: number): void {
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			focusWorkspace((index + 1) % options.length);
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			focusWorkspace((index - 1 + options.length) % options.length);
		} else if (event.key === 'Home') {
			event.preventDefault();
			focusWorkspace(0);
		} else if (event.key === 'End') {
			event.preventDefault();
			focusWorkspace(options.length - 1);
		}
	}
</script>

<div
	role="tablist"
	aria-label={ariaLabel}
	class="flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5"
>
	{#each options as workspace, index (workspace.id)}
		<button
			id={`${idPrefix}-${workspace.id}`}
			type="button"
			role="tab"
			aria-selected={value === workspace.id}
			aria-controls={panelId ?? `${idPrefix}-panel-${workspace.id}`}
			aria-label={workspace.label}
			tabindex={value === workspace.id ? 0 : -1}
			class="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-selected:bg-accent aria-selected:text-accent-foreground sm:px-3 md:h-7 md:min-w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11"
			onclick={() => selectWorkspace(workspace.id)}
			onkeydown={(event) => handleKeydown(event, index)}
		>
			{#if workspace.emblem.kind === 'protected'}
				<ProtectedIcon icon={workspace.emblem.role} class="size-3.5" />
			{:else}
				<ThemeIcon role={workspace.emblem.role} class="size-3.5" />
			{/if}
			<span class="hidden sm:inline">{workspace.label}</span>
		</button>
	{/each}
</div>
