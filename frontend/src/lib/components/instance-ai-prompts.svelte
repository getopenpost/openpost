<script lang="ts">
	import type { components } from '$lib/api/types';
	import { client } from '$lib/api/client';
	import AppSelect from '$lib/components/app-select.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import BracesIcon from '@lucide/svelte/icons/braces';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SaveIcon from '@lucide/svelte/icons/save';

	type Prompt = components['schemas']['AIPromptResponse'];
	type PromptsResponse = components['schemas']['AIPromptsResponse'];

	interface Props {
		active: boolean;
	}

	const platformLabels = new Map([
		['x', 'X'],
		['linkedin', 'LinkedIn'],
		['threads', 'Threads'],
		['facebook', 'Facebook'],
		['instagram', 'Instagram'],
		['youtube', 'YouTube'],
		['tiktok', 'TikTok'],
		['mastodon', 'Mastodon'],
		['bluesky', 'Bluesky']
	]);

	let { active }: Props = $props();
	const unsavedChanges = getOptionalUnsavedChanges();
	let loading = $state(false);
	let loaded = $state(false);
	let saving = $state(false);
	let resetting = $state(false);
	let error = $state('');
	let prompts = $state<Prompt[]>([]);
	let fixedOutputContract = $state('');
	let selectedKey = $state('');
	let previewPlatform = $state('x');
	let drafts = $state<Record<string, string>>({});
	let requestSequence = 0;

	const selected = $derived(prompts.find((prompt) => prompt.key === selectedKey) ?? null);
	const selectedDraft = $derived(selected ? (drafts[selected.key] ?? selected.value) : '');
	const dirty = $derived(
		active && prompts.some((prompt) => (drafts[prompt.key] ?? prompt.value) !== prompt.value)
	);
	const selectedDirty = $derived(Boolean(selected && selectedDraft !== selected.value));
	const selectedCharacterCount = $derived(Array.from(selectedDraft).length);
	const promptOptions = $derived(
		prompts.map((prompt) => ({
			value: prompt.key,
			label: prompt.overridden
				? `${promptLabel(prompt)} (${m.settings_ai_prompts_customized()})`
				: promptLabel(prompt)
		}))
	);
	const previewPlatformOptions = $derived(
		prompts
			.filter((prompt) => prompt.kind === 'platform' && prompt.platform)
			.map((prompt) => ({ value: prompt.platform ?? '', label: promptLabel(prompt) }))
	);
	const effectivePreview = $derived.by(() => {
		const base = prompts.find((prompt) => prompt.kind === 'base');
		const baseValue = base ? (drafts[base.key] ?? base.value) : '';
		const platform = prompts.find((prompt) => prompt.platform === previewPlatform);
		const platformValue = platform ? (drafts[platform.key] ?? platform.value) : '';
		const sections = [baseValue];
		if (platformValue) {
			sections.push(`Platform instructions:\n[${previewPlatform}]\n${platformValue}`);
		}
		if (fixedOutputContract) {
			sections.push(fixedOutputContract);
		}
		return sections.filter(Boolean).join('\n\n');
	});

	$effect(() => {
		if (active && !loaded && !loading) void load();
	});

	$effect(() => {
		if (selected?.kind === 'platform' && selected.platform) {
			previewPlatform = selected.platform;
		}
	});

	$effect(() => {
		unsavedChanges?.set('instance-ai-prompts', dirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('instance-ai-prompts');
	});

	function promptLabel(prompt: Prompt) {
		return prompt.kind === 'base'
			? m.settings_ai_prompts_base()
			: (platformLabels.get(prompt.platform ?? '') ?? prompt.platform ?? prompt.key);
	}

	function promptDescription(prompt: Prompt) {
		if (prompt.kind === 'base') return m.settings_ai_prompts_base_description();
		return m.settings_ai_prompts_platform_description({ platform: promptLabel(prompt) });
	}

	function formatDate(value: string) {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	async function load() {
		const sequence = ++requestSequence;
		loading = true;
		error = '';
		try {
			const { data, error: responseError } = await client.GET('/admin/ai-prompts');
			if (responseError || !data) {
				throw new Error(responseError?.detail || m.settings_ai_prompts_load_failed());
			}
			if (sequence !== requestSequence) return;
			applyCatalogue(data);
			loaded = true;
		} catch (cause) {
			if (sequence !== requestSequence) return;
			error = cause instanceof Error ? cause.message : m.settings_ai_prompts_load_failed();
		} finally {
			if (sequence === requestSequence) loading = false;
		}
	}

	function applyCatalogue(data: PromptsResponse) {
		prompts = data.prompts ?? [];
		fixedOutputContract = data.fixed_output_contract;
		drafts = Object.fromEntries(prompts.map((prompt) => [prompt.key, prompt.value]));
		if (!prompts.some((prompt) => prompt.key === selectedKey)) {
			selectedKey = prompts[0]?.key ?? '';
		}
	}

	function updatePrompt(next: Prompt) {
		prompts = prompts.map((prompt) => (prompt.key === next.key ? next : prompt));
		drafts[next.key] = next.value;
	}

	async function saveValue(prompt: Prompt, value: string) {
		const { data, error: responseError } = await client.PUT('/admin/ai-prompts/{key}', {
			params: { path: { key: prompt.key } },
			body: { value }
		});
		if (responseError || !data) {
			throw new Error(responseError?.detail || m.settings_ai_prompts_save_failed());
		}
		updatePrompt(data);
		return data;
	}

	function showSaveError(cause: unknown) {
		showToast(
			cause instanceof Error ? cause.message : m.settings_ai_prompts_save_failed(),
			'error'
		);
	}

	async function saveSelected() {
		if (!selected || !selectedDirty || saving) return;
		saving = true;
		try {
			await saveValue(selected, selectedDraft);
			showToast(m.settings_ai_prompts_saved(), 'success');
		} catch (cause) {
			showSaveError(cause);
		} finally {
			saving = false;
		}
	}

	async function restoreBuiltIn() {
		if (!selected || !selected.overridden || selectedDirty || resetting) return;
		const previous = selected.value;
		const target = selected;
		resetting = true;
		try {
			const reset = await saveValue(target, target.default_value);
			showToast(m.settings_ai_prompts_reset(), 'success', {
				actionLabel: m.settings_ai_prompts_undo(),
				onAction: () => {
					void saveValue(reset, previous)
						.then(() => showToast(m.settings_ai_prompts_saved(), 'success'))
						.catch(showSaveError);
				}
			});
		} catch (cause) {
			showSaveError(cause);
		} finally {
			resetting = false;
		}
	}
</script>

<div class="space-y-6" data-testid="instance-ai-prompts">
	<InlineNotice tone="info" message={m.settings_ai_prompts_intro()} />

	{#if loading && !loaded}
		<PageLoading layout="settings" label={m.common_loading()} items={7} />
	{:else if error}
		<InlineNotice tone="error" message={error}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={() => void load()}>{m.common_retry()}</Button>
			{/snippet}
		</InlineNotice>
	{:else if selected}
		<div
			class="overflow-hidden rounded-xl border bg-card lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"
		>
			<aside
				class="border-b bg-muted/25 p-3 lg:border-r lg:border-b-0"
				aria-label={m.settings_ai_prompts()}
			>
				<div class="lg:hidden">
					<AppSelect
						bind:value={selectedKey}
						options={promptOptions}
						ariaLabel={m.settings_ai_prompts()}
						class="min-h-11 w-full bg-background"
					/>
				</div>
				<div class="hidden space-y-1 lg:block">
					{#each prompts as prompt (prompt.key)}
						<button
							type="button"
							class={[
								'flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
								selectedKey === prompt.key
									? 'bg-background font-medium text-foreground shadow-xs'
									: 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
							]}
							onclick={() => (selectedKey = prompt.key)}
							aria-current={selectedKey === prompt.key ? 'page' : undefined}
						>
							<span class="truncate">{promptLabel(prompt)}</span>
							{#if prompt.overridden}
								<span class="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
								<span class="sr-only">{m.settings_ai_prompts_customized()}</span>
							{/if}
						</button>
					{/each}
				</div>
			</aside>

			<section class="min-w-0 space-y-6 p-4 sm:p-6">
				<header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<h2 class="text-base font-semibold">{promptLabel(selected)}</h2>
							<Badge variant={selected.overridden ? 'default' : 'secondary'}>
								{selected.overridden
									? m.settings_ai_prompts_customized()
									: m.settings_ai_prompts_built_in()}
							</Badge>
						</div>
						<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
							{promptDescription(selected)}
						</p>
					</div>
					<p class="shrink-0 text-xs text-muted-foreground">
						{m.settings_ai_prompts_default_version({ version: selected.default_version })}
					</p>
				</header>

				<div class="space-y-2">
					<div class="flex items-end justify-between gap-4">
						<Label for="ai-prompt-editor">{m.settings_ai_prompts_prompt()}</Label>
						<span class="text-xs text-muted-foreground tabular-nums">
							{m.settings_ai_prompts_characters({ count: selectedCharacterCount })}
						</span>
					</div>
					<Textarea
						id="ai-prompt-editor"
						value={selectedDraft}
						oninput={(event) => (drafts[selected.key] = event.currentTarget.value)}
						maxlength={20000}
						class="min-h-80 resize-y text-sm leading-6"
					/>
					{#if selected.overridden && selected.updated_at}
						<p class="text-xs text-muted-foreground">
							{m.settings_ai_prompts_updated({
								name: selected.updated_by || m.settings_ai_prompts_customized(),
								date: formatDate(selected.updated_at)
							})}
						</p>
					{/if}
					{#if selected.overridden}
						<details class="rounded-md border bg-muted/20">
							<summary
								class="flex min-h-11 cursor-pointer list-none items-center px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
							>
								{m.settings_ai_prompts_builtin_default()}
							</summary>
							<p
								class="border-t px-3 py-3 text-sm leading-6 whitespace-pre-wrap text-muted-foreground"
							>
								{selected.default_value}
							</p>
						</details>
					{/if}
				</div>

				<div class="rounded-lg border bg-muted/20">
					<details>
						<summary
							class="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						>
							<BracesIcon class="size-4 text-muted-foreground" />
							{m.settings_ai_prompts_preview()}
						</summary>
						<div class="border-t px-4 py-4">
							<div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
								<p class="max-w-2xl text-xs leading-5 text-muted-foreground">
									{m.settings_ai_prompts_preview_description()}
								</p>
								<div class="w-full shrink-0 space-y-1.5 sm:w-48">
									<Label for="ai-prompt-preview-platform" class="text-xs">
										{m.settings_ai_prompts_preview_platform()}
									</Label>
									<AppSelect
										id="ai-prompt-preview-platform"
										bind:value={previewPlatform}
										options={previewPlatformOptions}
										ariaLabel={m.settings_ai_prompts_preview_platform()}
										class="min-h-11 w-full bg-background"
									/>
								</div>
							</div>
							<pre
								class="max-h-96 overflow-auto rounded-md bg-background p-4 text-sm leading-6 whitespace-pre-wrap text-foreground">{effectivePreview}</pre>
						</div>
					</details>
				</div>

				<div class="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
					<div class="flex flex-wrap gap-2">
						{#if selectedDirty}
							<Button variant="ghost" onclick={() => (drafts[selected.key] = selected.value)}>
								<RotateCcwIcon class="size-4" />
								{m.settings_ai_prompts_discard_edits()}
							</Button>
						{/if}
						<Button
							variant="outline"
							disabled={!selected.overridden || selectedDirty || resetting || saving}
							onclick={() => void restoreBuiltIn()}
						>
							<RotateCcwIcon class="size-4" />
							{m.settings_ai_prompts_use_builtin()}
						</Button>
					</div>
					<Button
						disabled={!selectedDirty || selectedDraft.trim().length === 0 || saving}
						onclick={() => void saveSelected()}
					>
						{#if saving}
							<LoaderIcon class="size-4 animate-spin" />
							{m.settings_ai_prompts_saving()}
						{:else}
							<SaveIcon class="size-4" />
							{m.settings_ai_prompts_save()}
						{/if}
					</Button>
				</div>
			</section>
		</div>
	{/if}
</div>
