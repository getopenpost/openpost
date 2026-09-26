<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import { m } from '$lib/paraglide/messages';
	import { saveImageEditorEffectPreset, deleteImageEditorEffectPreset } from '../api';
	import { defaultLayerEffects } from '../effects';
	import { useImageEditor } from '../editor.svelte';
	import type { ImageEditorLayer } from '../types';

	let {
		layer,
		canUseInnerShadow,
		canUseStroke
	}: {
		layer: ImageEditorLayer;
		canUseInnerShadow: boolean;
		canUseStroke: boolean;
	} = $props();
	const editor = useImageEditor();
	let presetID = $state('');
	let name = $state('');
	let busy = $state(false);
	let feedback = $state('');
	let error = $state('');
	let presets = $derived(editor.brandKit?.effect_presets ?? []);
	let preset = $derived(presets.find((entry) => entry.id === presetID));
	let canManage = $derived(
		editor.brandKit?.can_edit && editor.brandKit.workspace_id === editor.workspaceID
	);
	let compatible = $derived(
		preset &&
			(!preset.effects.inner_shadow || canUseInnerShadow) &&
			(!preset.effects.stroke || canUseStroke)
	);
	const fieldID = $props.id();

	$effect(() => {
		void editor.workspaceID;
		presetID = '';
		name = '';
		feedback = '';
		error = '';
	});

	function apply(): void {
		if (!preset || !compatible || !editor.canEdit || layer.locked) return;
		editor.updateLayer(layer.id, { effects: structuredClone($state.snapshot(preset.effects)) });
		feedback = m.image_editor_effect_preset_applied();
	}

	async function save(mode: 'new' | 'update' | 'rename'): Promise<void> {
		if (!canManage || busy || !name.trim() || (mode !== 'new' && !preset)) return;
		const workspaceID = editor.workspaceID;
		const id = mode === 'new' ? crypto.randomUUID() : presetID;
		const effects = structuredClone(
			$state.snapshot(
				mode === 'rename' && preset ? preset.effects : (layer.effects ?? defaultLayerEffects())
			)
		);
		busy = true;
		error = '';
		feedback = '';
		try {
			const kit = await saveImageEditorEffectPreset(workspaceID, {
				id,
				name: mode === 'update' && preset ? preset.name : name.trim(),
				effects
			});
			if (editor.workspaceID !== workspaceID) return;
			editor.setBrandKit(kit);
			presetID = id;
			name = kit.effect_presets?.find((entry) => entry.id === id)?.name ?? name;
			feedback = m.image_editor_effect_preset_saved();
		} catch (cause) {
			if (editor.workspaceID === workspaceID)
				error = cause instanceof Error ? cause.message : m.image_editor_effect_preset_failed();
		} finally {
			busy = false;
		}
	}

	async function remove(): Promise<void> {
		if (!canManage || busy || !preset) return;
		const workspaceID = editor.workspaceID;
		busy = true;
		error = '';
		feedback = '';
		try {
			const kit = await deleteImageEditorEffectPreset(workspaceID, presetID);
			if (editor.workspaceID !== workspaceID) return;
			editor.setBrandKit(kit);
			presetID = '';
			name = '';
			feedback = m.image_editor_effect_preset_deleted();
		} catch (cause) {
			if (editor.workspaceID === workspaceID)
				error = cause instanceof Error ? cause.message : m.image_editor_effect_preset_failed();
		} finally {
			busy = false;
		}
	}
</script>

<div class="space-y-2 border-b pb-3" aria-label={m.image_editor_effect_presets()}>
	<p class="text-xs font-medium">{m.image_editor_effect_presets()}</p>
	{#if presets.length}
		<div class="flex min-w-0 items-center gap-1">
			<AppSelect
				value={presetID}
				options={presets.map((entry) => ({ value: entry.id, label: entry.name }))}
				placeholder={m.image_editor_effect_preset_choose()}
				ariaLabel={m.image_editor_effect_preset_choose()}
				class="min-w-0 flex-1"
				disabled={busy}
				onValueChange={(id) => {
					presetID = id;
					name = presets.find((entry) => entry.id === id)?.name ?? '';
					feedback = '';
					error = '';
				}}
			/>
			<Button
				variant="outline"
				size="xs"
				disabled={!compatible || !editor.canEdit || layer.locked || busy}
				onclick={apply}>{m.image_editor_effect_preset_apply()}</Button
			>
		</div>
		{#if preset && !compatible}<p class="text-xs text-muted-foreground">
				{m.image_editor_effect_preset_incompatible()}
			</p>{/if}
	{/if}
	{#if canManage}
		<label for={fieldID} class="block text-xs text-muted-foreground"
			>{m.image_editor_effect_preset_name()}</label
		>
		<Input
			id={fieldID}
			bind:value={name}
			maxlength={120}
			disabled={busy}
			class="h-[var(--editor-22,22px)] min-h-0 text-xs [@media(pointer:coarse)]:min-h-11"
		/>
		<div class="flex flex-wrap gap-1">
			<Button
				variant="outline"
				size="xs"
				disabled={busy || !name.trim()}
				onclick={() => save('new')}>{m.image_editor_effect_preset_save_new()}</Button
			>
			{#if preset}
				<Button
					variant="outline"
					size="xs"
					disabled={busy || !name.trim() || name.trim() === preset.name}
					onclick={() => save('rename')}>{m.image_editor_effect_preset_rename()}</Button
				>
				<Button
					variant="outline"
					size="xs"
					disabled={busy || !name.trim()}
					onclick={() => save('update')}>{m.image_editor_effect_preset_update()}</Button
				>
				<Button variant="ghost" size="xs" disabled={busy} onclick={remove}
					>{m.image_editor_effect_preset_delete()}</Button
				>
			{/if}
		</div>
	{:else if !presets.length}
		<p class="text-xs text-muted-foreground">{m.image_editor_effect_presets_workspace()}</p>
	{/if}
	{#if feedback}<p class="text-xs text-muted-foreground" role="status">{feedback}</p>{/if}
	{#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}
</div>
