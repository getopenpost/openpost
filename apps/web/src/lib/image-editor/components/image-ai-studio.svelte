<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { createQuery } from '@tanstack/svelte-query';
	import { OpenPostQueryError } from '@openpost/query-catalog';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import AppSelect from '$lib/components/app-select.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import { auth } from '$lib/stores/auth';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { queryMediaMetadata } from '$lib/query/media';
	import {
		imageGenerationConfigQuery,
		imageGenerationHistoryQuery,
		createImageGeneration,
		type ImageGenerationRequest,
		type ImageGenerationRun
	} from '$lib/query/image-generation';
	import { prepareImageAIRequest, applyImageAIResult } from '../ai-images';
	import { useImageEditor } from '../editor.svelte';
	import { m } from '$lib/paraglide/messages';

	let {
		open = $bindable(false),
		guestMode = false,
		onSaveToOpenPost
	}: { open?: boolean; guestMode?: boolean; onSaveToOpenPost?: () => Promise<void> } = $props();
	const editor = useImageEditor();
	let operation = $state<ImageGenerationRequest['operation']>('generate');
	let prompt = $state('');
	let model = $state<ImageGenerationRequest['model']>('gpt-image-2.5-flare');
	let quality = $state<ImageGenerationRequest['quality']>('high');
	let size = $state<ImageGenerationRequest['size']>('square_hd');
	let background = $state<ImageGenerationRequest['background']>('auto');
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let selectedID = $state('');
	let showOriginal = $state(false);
	let appliedID = $state('');
	let pendingRequest: { request: ImageGenerationRequest; key: string; actorId: string } | null =
		$state(null);
	const actorId = $derived($auth.user?.id ?? '');
	const selectedLayer = $derived(
		editor.selectedLayers.length === 1 ? editor.selectedLayers[0] : undefined
	);
	const canEditImage = $derived(
		Boolean(selectedLayer?.image && !editor.isLayerLocked(selectedLayer.id))
	);
	const hasSelection = $derived(Boolean(editor.pixelSelection?.data.some(Boolean)));
	const config = createQuery(() => ({
		...imageGenerationConfigQuery(actorId),
		enabled: open && !guestMode && Boolean(actorId)
	}));
	const history = createQuery(() => ({
		...imageGenerationHistoryQuery(editor.workspaceID, actorId, editor.id),
		enabled: open && Boolean(editor.workspaceID && actorId),
		refetchInterval: (query) =>
			query.state.data?.some((run) => !['completed', 'failed', 'unknown'].includes(run.state))
				? 3000
				: query.state.data?.some((run) => run.billing_state === 'pending')
					? 15000
					: false
	}));
	const runs = $derived(history.data ?? []);
	const models = $derived(config.data?.models ?? []);
	const selected = $derived(runs.find((run) => run.id === selectedID) ?? runs[0]);
	const generating = $derived(
		runs.some((run) => !['completed', 'failed', 'unknown'].includes(run.state))
	);
	const targetReady = $derived(
		operation === 'generate' || (operation === 'edit' ? canEditImage : hasSelection)
	);
	const previewID = $derived(showOriginal ? selected?.source_media_id : selected?.result_media_id);
	const qualityOptions = $derived<
		Array<{ value: ImageGenerationRequest['quality']; label: string }>
	>([
		{ value: 'low', label: m.image_ai_quality_low() },
		{ value: 'medium', label: m.image_ai_quality_medium() },
		{ value: 'high', label: m.image_ai_quality_high() },
		{ value: 'xhigh', label: m.image_ai_quality_xhigh() },
		{ value: 'max', label: m.image_ai_quality_max() }
	]);
	const sizeOptions = $derived<Array<{ value: ImageGenerationRequest['size']; label: string }>>([
		{ value: 'square_hd', label: m.image_ai_square() },
		{ value: 'portrait_4_3', label: m.image_ai_portrait() },
		{ value: 'landscape_4_3', label: m.image_ai_landscape() },
		{ value: 'portrait_16_9', label: m.image_ai_tall() },
		{ value: 'landscape_16_9', label: m.image_ai_wide() }
	]);
	const backgroundOptions = $derived<
		Array<{ value: ImageGenerationRequest['background']; label: string }>
	>([
		{ value: 'auto', label: m.image_ai_automatic() },
		{ value: 'opaque', label: m.image_ai_opaque() },
		{ value: 'transparent', label: m.image_ai_transparent() }
	]);

	export function openFor(next: ImageGenerationRequest['operation']) {
		operation = next;
		open = true;
	}
	function openStudio() {
		openFor(hasSelection ? 'fill' : canEditImage ? 'edit' : 'generate');
	}
	function stateLabel(run: ImageGenerationRun) {
		if (run.state === 'completed') return m.image_ai_ready();
		if (run.state === 'failed') return m.image_ai_status_failed();
		if (run.state === 'unknown') return m.image_ai_unknown();
		if (run.state === 'saving') return m.image_ai_saving();
		return run.state === 'generating' ? m.image_ai_generating() : m.image_ai_queued();
	}
	function costLabel(run: ImageGenerationRun) {
		if (run.cost_microusd !== null)
			return new Intl.NumberFormat(undefined, {
				style: 'currency',
				currency: 'USD',
				minimumFractionDigits: 2,
				maximumFractionDigits: 4
			}).format(run.cost_microusd / 1_000_000);
		return run.billing_state === 'pending' ? m.image_ai_cost_pending() : m.image_ai_cost_unknown();
	}
	async function submit() {
		if (busy) return;
		busy = true;
		error = '';
		notice = '';
		const workspaceId = editor.workspaceID,
			projectId = editor.id,
			userId = actorId;
		try {
			if (!pendingRequest) {
				const request = await prepareImageAIRequest(editor, {
					operation,
					prompt,
					model,
					quality,
					size,
					background
				});
				if (editor.id !== projectId || editor.workspaceID !== workspaceId || actorId !== userId)
					return;
				pendingRequest = { request, key: crypto.randomUUID(), actorId: userId };
			}
			if (
				pendingRequest.request.workspace_id !== workspaceId ||
				pendingRequest.request.project_id !== projectId ||
				pendingRequest.actorId !== userId
			)
				throw new Error(m.image_ai_stale());
			const result = await createImageGeneration(
				pendingRequest.request,
				userId,
				pendingRequest.key
			);
			if (editor.id !== projectId || editor.workspaceID !== workspaceId || actorId !== userId)
				return;
			pendingRequest = null;
			selectedID = result.id;
			showOriginal = false;
			appliedID = '';
		} catch (cause) {
			if (
				cause instanceof OpenPostQueryError &&
				cause.status &&
				[400, 401, 403, 404, 409, 413, 422].includes(cause.status)
			)
				pendingRequest = null;
			error = cause instanceof Error ? cause.message : m.image_ai_failed();
		} finally {
			busy = false;
		}
	}
	async function apply(asNewLayer = false) {
		if (!selected?.result_media_id || busy) return;
		const result = selected,
			userId = actorId;
		busy = true;
		error = '';
		notice = '';
		try {
			const metadata = await queryMediaMetadata(editor.workspaceID, [result.result_media_id], {
				force: true
			});
			const media = metadata.media.find((item) => item.id === result.result_media_id);
			if (!media?.width || !media.height || actorId !== userId)
				throw new Error(m.image_ai_missing_result());
			await applyImageAIResult(
				editor,
				result,
				{ id: media.id, width: media.width, height: media.height },
				asNewLayer
			);
			appliedID = result.id;
			notice = m.image_ai_applied();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_ai_failed();
		} finally {
			busy = false;
		}
	}
</script>

<Button
	variant={open ? 'secondary' : 'ghost'}
	size="sm"
	class="h-8 shrink-0 px-2 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
	onclick={openStudio}
	aria-label={m.image_ai_title()}
	title={m.image_ai_title()}
>
	<ThemeIcon role="image-add" /><span class="hidden 2xl:inline">{m.image_ai_title()}</span>
</Button>
<Sheet.Root bind:open>
	{#if open}
		<Sheet.Portal>
			<DialogPrimitive.Content
				trapFocus={false}
				preventScroll={false}
				onInteractOutside={(event) => event.preventDefault()}
			>
				{#snippet child({ props })}
					<div
						{...props}
						aria-modal="false"
						aria-describedby={undefined}
						class="fixed inset-x-0 bottom-0 z-40 flex h-[50dvh] flex-col border-t border-border bg-background text-foreground outline-none lg:top-20 lg:left-auto lg:h-auto lg:w-96 lg:border-t-0 lg:border-l"
						onkeydown={(event) => {
							if (event.key !== 'Escape') event.stopPropagation();
						}}
					>
						<div
							class="flex shrink-0 items-center justify-between border-b border-border px-4 py-2"
						>
							<Sheet.Title class="text-sm font-medium">{m.image_ai_title()}</Sheet.Title>
							<Sheet.Close
								>{#snippet child({ props })}<Button
										{...props}
										variant="ghost"
										size="icon-sm"
										class="[@media(pointer:coarse)]:size-11"
										aria-label={m.common_close()}><ThemeIcon role="close" /></Button
									>{/snippet}</Sheet.Close
							>
						</div>
						<div
							class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
						>
							{#if guestMode}<p class="text-sm text-muted-foreground">{m.image_ai_save_first()}</p>
								<Button class="w-full" onclick={onSaveToOpenPost}
									>{m.image_editor_public_save_openpost()}</Button
								>
							{:else if config.isPending}<p role="status" class="text-sm text-muted-foreground">
									{m.common_loading()}
								</p>
							{:else if config.error}<InlineNotice tone="error" message={m.image_ai_failed()}
									><Button variant="outline" size="sm" onclick={() => config.refetch()}
										>{m.common_retry()}</Button
									></InlineNotice
								>
							{:else if !config.data?.available}<InlineNotice message={m.image_ai_unconfigured()} />
							{:else}
								<form
									class="space-y-3"
									onsubmit={(event) => {
										event.preventDefault();
										void submit();
									}}
								>
									<AppSelect
										value={operation}
										ariaLabel={m.image_ai_action()}
										options={[
											{ value: 'generate', label: m.image_ai_generate() },
											{ value: 'edit', label: m.image_ai_edit() },
											{ value: 'fill', label: m.image_ai_fill() }
										]}
										onValueChange={(value) => {
											if (value === 'generate' || value === 'edit' || value === 'fill')
												operation = value;
										}}
									/>
									{#if operation === 'edit' && selectedLayer?.image}<div
											class="flex items-center gap-3"
										>
											<img
												src={getAuthenticatedMediaURL(`/media/${selectedLayer.image.media_id}`)}
												alt=""
												class="size-12 rounded object-contain"
											/><span class="min-w-0 truncate text-sm">{selectedLayer.name}</span>
										</div>{/if}
									{#if !targetReady}<p class="text-sm text-muted-foreground">
											{operation === 'edit' ? m.image_ai_select_layer() : m.image_ai_select_area()}
										</p>{/if}
									<label class="grid gap-1.5 text-xs font-medium"
										><span
											>{operation === 'generate'
												? m.image_ai_prompt()
												: m.image_ai_edit_prompt()}</span
										><Textarea
											bind:value={prompt}
											rows={3}
											maxlength={8000}
											placeholder={operation === 'generate'
												? m.image_ai_prompt_example()
												: m.image_ai_edit_example()}
											disabled={busy}
										/></label
									>
									<details class="group">
										<summary
											class="cursor-pointer py-2 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:py-3"
											>{models.find((item) => item.id === model)?.name} · {qualityOptions.find(
												(item) => item.value === quality
											)?.label}</summary
										>
										<div class="grid gap-3 py-2">
											<label class="grid gap-1 text-xs"
												><span>{m.image_ai_model()}</span><AppSelect
													value={model}
													ariaLabel={m.image_ai_model()}
													options={models.map((item) => ({ value: item.id, label: item.name }))}
													onValueChange={(value) => {
														if (
															value === 'gpt-image-2.5-flare' ||
															value === 'gpt-image-2.5-sunburst'
														)
															model = value;
													}}
												/></label
											>
											<label class="grid gap-1 text-xs"
												><span>{m.image_ai_quality()}</span><AppSelect
													value={quality}
													ariaLabel={m.image_ai_quality()}
													options={qualityOptions}
													onValueChange={(value) =>
														(quality =
															qualityOptions.find((item) => item.value === value)?.value ?? 'high')}
												/></label
											>
											{#if operation === 'generate'}<label class="grid gap-1 text-xs"
													><span>{m.image_ai_shape()}</span><AppSelect
														value={size}
														ariaLabel={m.image_ai_shape()}
														options={sizeOptions}
														onValueChange={(value) =>
															(size =
																sizeOptions.find((item) => item.value === value)?.value ??
																'square_hd')}
													/></label
												>{/if}
											<label class="grid gap-1 text-xs"
												><span>{m.image_ai_background()}</span><AppSelect
													value={background}
													ariaLabel={m.image_ai_background()}
													options={backgroundOptions}
													onValueChange={(value) =>
														(background =
															backgroundOptions.find((item) => item.value === value)?.value ??
															'auto')}
												/></label
											>
										</div>
									</details>
									<Button
										type="submit"
										class="w-full [@media(pointer:coarse)]:min-h-11"
										disabled={busy ||
											Boolean(pendingRequest) ||
											generating ||
											!targetReady ||
											!prompt.trim()}
										>{busy
											? m.image_ai_preparing()
											: generating
												? m.image_ai_generating()
												: operation === 'generate'
													? m.image_ai_generate()
													: operation === 'edit'
														? m.image_ai_edit()
														: m.image_ai_fill()}</Button
									>
									<p class="text-xs text-muted-foreground">{m.image_ai_disclosure()}</p>
								</form>
							{/if}
							{#if error}<InlineNotice
									tone="error"
									message={error}
									onDismiss={() => (error = '')}
								/>{/if}
							{#if pendingRequest}<Button variant="outline" disabled={busy} onclick={() => submit()}
									>{m.image_ai_retry_submission()}</Button
								>{/if}
							{#if notice}<p role="status" class="text-sm">{notice}</p>{/if}
							{#if history.error}<InlineNotice tone="error" message={m.image_ai_history_failed()}
									><Button variant="outline" size="sm" onclick={() => history.refetch()}
										>{m.common_retry()}</Button
									></InlineNotice
								>{/if}
							{#if selected}
								<section
									class="space-y-3 border-t border-border pt-4"
									aria-label={m.image_ai_result()}
								>
									<div class="flex items-center justify-between gap-3 text-xs">
										<span role="status">{stateLabel(selected)}</span><span
											class="text-muted-foreground">{costLabel(selected)}</span
										>
									</div>
									{#if selected.error_message}<InlineNotice
											tone={selected.state === 'saving' ? 'info' : 'warning'}
											message={selected.error_message}
										/>{/if}
									{#if previewID}<img
											src={getAuthenticatedMediaURL(`/media/${previewID}`)}
											alt={showOriginal ? m.image_ai_original() : selected.prompt}
											class="max-h-64 w-full rounded object-contain"
										/>{/if}
									{#if selected.result_media_id}
										{#if selected.source_media_id}<Button
												variant="ghost"
												size="sm"
												class="w-full"
												aria-pressed={showOriginal}
												onclick={() => (showOriginal = !showOriginal)}
												>{showOriginal
													? m.image_ai_show_result()
													: m.image_ai_show_original()}</Button
											>{/if}
										<Button
											class="w-full [@media(pointer:coarse)]:min-h-11"
											disabled={busy || appliedID === selected.id}
											onclick={() => apply()}
											>{appliedID === selected.id
												? m.image_ai_added()
												: selected.operation === 'edit'
													? m.image_ai_apply_edit()
													: selected.operation === 'fill'
														? m.image_ai_apply_fill()
														: m.image_ai_add_layer()}</Button
										>
										{#if selected.operation === 'edit'}<Button
												variant="outline"
												class="w-full"
												disabled={busy}
												onclick={() => apply(true)}>{m.image_ai_add_layer()}</Button
											>{/if}
									{/if}
								</section>
							{/if}
							{#if runs.length > 1}<section class="space-y-2 border-t border-border pt-4">
									<h3 class="text-xs font-medium">{m.image_ai_recent()}</h3>
									<div class="grid grid-cols-3 gap-2">
										{#each runs as run (run.id)}<button
												type="button"
												class="min-w-0 rounded border border-border p-1 text-left text-xs focus-visible:outline-2 focus-visible:outline-ring {selected?.id ===
												run.id
													? 'bg-navigation-active text-navigation-active-foreground'
													: 'hover:bg-muted'}"
												aria-pressed={selected?.id === run.id}
												title={run.prompt}
												onclick={() => {
													selectedID = run.id;
													showOriginal = false;
													notice = '';
													error = '';
												}}
												>{#if run.result_media_id}<img
														src={getAuthenticatedMediaURL(`/media/${run.result_media_id}`)}
														alt=""
														class="aspect-square w-full rounded object-cover"
														loading="lazy"
													/>{:else}<span
														class="flex aspect-square items-center justify-center p-1 text-center"
														>{stateLabel(run)}</span
													>{/if}<span class="mt-1 block truncate">{run.prompt}</span></button
											>{/each}
									</div>
								</section>{/if}
						</div>
					</div>
				{/snippet}
			</DialogPrimitive.Content>
		</Sheet.Portal>
	{/if}
</Sheet.Root>
