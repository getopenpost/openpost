<script lang="ts">
	import { onMount } from 'svelte';
	import { client } from '$lib/api/client';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import PageContainer from '$lib/components/page-container.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import ShuffleIcon from '@lucide/svelte/icons/shuffle';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages';

	interface Prompt {
		id: string;
		workspace_id?: string;
		user_id?: string;
		text: string;
		example?: string;
		category: string;
		is_built_in: boolean;
		created_at: string;
	}

	let prompts = $state<Prompt[]>([]);
	let categories = $state<string[]>([]);
	let loading = $state(false);
	let loadingCategories = $state(false);
	let categoriesError = $state('');
	let selectedCategory = $state<string>('all');
	let showAddPrompt = $state(false);
	let newPromptText = $state('');
	let newPromptExample = $state('');
	let newPromptCategory = $state('');
	let submitting = $state(false);
	let toastMessage = $state('');
	let toastTone = $state<'success' | 'error'>('success');
	let error = $state('');
	let hasLoaded = $state(false);
	let deleteDialogOpen = $state(false);
	let promptToDelete = $state.raw<Prompt | null>(null);
	let promptsRequestSequence = 0;
	let loadedPromptsKey = '';
	let categoriesRequested = false;

	interface PromptsQueryParams {
		workspace_id: string;
		category?: string;
	}

	async function loadPrompts(
		workspaceID = workspaceCtx.currentWorkspace?.id ?? '',
		category = selectedCategory
	) {
		if (!workspaceID) return;
		const requestSequence = ++promptsRequestSequence;
		const queryKey = `${workspaceID}:${category}`;
		const queryChanged = loadedPromptsKey !== queryKey;
		loadedPromptsKey = queryKey;
		if (queryChanged) {
			prompts = [];
			hasLoaded = false;
		}
		loading = true;
		error = '';
		try {
			const params: PromptsQueryParams = { workspace_id: workspaceID };
			if (category !== 'all') {
				params.category = category;
			}
			const { data, error: err } = await client.GET('/prompts', {
				params: { query: params }
			});
			if (err) throw new Error(err.detail || m.prompts_load_failed());
			if (requestSequence !== promptsRequestSequence) return;
			prompts = data ?? [];
		} catch (e) {
			if (requestSequence !== promptsRequestSequence) return;
			console.error('Failed to load prompts:', e);
			error = (e as Error).message || m.prompts_load_failed();
		} finally {
			if (requestSequence === promptsRequestSequence) {
				loading = false;
				hasLoaded = true;
			}
		}
	}

	async function loadCategories() {
		loadingCategories = true;
		categoriesError = '';
		try {
			const { data, error: err } = await client.GET('/prompts/categories');
			if (err) throw new Error(err.detail || m.prompts_load_failed());
			categories = data?.categories ?? [];
			if (categories.length > 0 && !newPromptCategory) {
				newPromptCategory = categories[0];
			}
		} catch (e) {
			console.error('Failed to load categories:', e);
			categoriesError = (e as Error).message || m.prompts_load_failed();
		} finally {
			loadingCategories = false;
		}
	}

	async function addPrompt() {
		if (!workspaceCtx.currentWorkspace || !newPromptText.trim() || !newPromptCategory) return;
		submitting = true;
		try {
			const { error: err } = await client.POST('/prompts', {
				body: {
					workspace_id: workspaceCtx.currentWorkspace.id,
					text: newPromptText.trim(),
					example: newPromptExample.trim(),
					category: newPromptCategory
				}
			});
			if (err) throw err;
			showAddPrompt = false;
			newPromptText = '';
			newPromptExample = '';
			toastTone = 'success';
			toastMessage = m.prompts_created();
			await loadPrompts();
		} catch (e) {
			toastTone = 'error';
			toastMessage = (e as Error).message || m.prompts_create_failed();
		} finally {
			submitting = false;
		}
	}

	function requestDeletePrompt(prompt: Prompt) {
		promptToDelete = prompt;
		deleteDialogOpen = true;
	}

	async function deletePrompt(): Promise<DestructiveActionOutcome> {
		const prompt = promptToDelete;
		if (!prompt) return { ok: false };
		try {
			const { error: err } = await client.DELETE('/prompts/{id}', {
				params: { path: { id: prompt.id } }
			});
			if (err) throw err;
			await loadPrompts();
			return { ok: true, successMessage: m.prompts_deleted() };
		} catch (e) {
			return { ok: false, message: (e as Error).message || m.prompts_delete_failed() };
		}
	}

	async function getRandomPrompt() {
		if (!workspaceCtx.currentWorkspace) return;
		try {
			const params: PromptsQueryParams = { workspace_id: workspaceCtx.currentWorkspace.id };
			if (selectedCategory !== 'all') {
				params.category = selectedCategory;
			}
			const { data, error: err } = await client.GET('/prompts/random', {
				params: { query: params }
			});
			if (err) throw new Error(err.detail || m.prompts_random_failed());
			if (!data) throw new Error(m.prompts_random_failed());
			ui.setPrompt({ text: data.text, example: data.example });
			goto(resolve('/'));
		} catch (e) {
			console.error('Failed to get random prompt:', e);
			toastTone = 'error';
			toastMessage = (e as Error).message || m.prompts_random_failed();
		}
	}

	function usePrompt(prompt: Prompt) {
		ui.setPrompt({ text: prompt.text, example: prompt.example ?? '' });
		goto(resolve('/'));
	}

	$effect(() => {
		const workspaceID = workspaceCtx.currentWorkspace?.id ?? '';
		const category = selectedCategory;
		if (workspaceID) {
			void loadPrompts(workspaceID, category);
			if (!categoriesRequested) {
				categoriesRequested = true;
				void loadCategories();
			}
		}
	});
</script>

<svelte:head>
	<title>{m.prompts_page_title()}</title>
</svelte:head>

{#if toastMessage}
	<AppToast
		message={toastMessage}
		tone={toastTone}
		dismissLabel={m.common_close()}
		onDismiss={() => (toastMessage = '')}
	/>
{/if}

<PageContainer
	title={m.prompts_title()}
	description={m.prompts_description()}
	icon={LightbulbIcon}
	loading={!workspaceCtx.currentWorkspace || (!hasLoaded && loading)}
	loadingMessage={m.common_loading()}
	loadingLayout="grid"
	loadingActionCount={3}
>
	{#snippet actions()}
		{#if loadingCategories && categories.length === 0}
			<Skeleton class="h-9 w-32" />
		{:else}
			<Select.Root
				type="single"
				value={selectedCategory}
				onValueChange={(value) => {
					selectedCategory = value;
				}}
			>
				<Select.Trigger class="w-40">
					{selectedCategory === 'all' ? m.prompts_all_categories() : selectedCategory}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">{m.prompts_all_categories()}</Select.Item>
					{#each categories as category (category)}
						<Select.Item value={category}>{category}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
		<Button onclick={getRandomPrompt} variant="outline" class="gap-2">
			<ShuffleIcon class="size-4" />
			{m.prompts_random()}
		</Button>
		<Button onclick={() => (showAddPrompt = true)} class="gap-2">
			<PlusIcon class="size-4" />
			{m.prompts_add()}
		</Button>
	{/snippet}

	<div class="space-y-6">
		{#if categoriesError}
			<InlineNotice tone="error" message={categoriesError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={loadCategories}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{/if}
		{#if error}
			<InlineNotice
				tone="error"
				message={error}
				dismissLabel={m.common_close()}
				onDismiss={() => (error = '')}
			/>
		{/if}

		<!-- Prompts Grid -->
		{#if loading && prompts.length > 0}
			<span class="sr-only" role="status">{m.common_loading()}</span>
		{/if}
		{#if loading && prompts.length === 0}
			<PageLoading layout="grid" label={m.common_loading()} items={8} />
		{:else if !error && prompts.length === 0}
			<EmptyState
				icon={LightbulbIcon}
				title={m.prompts_empty()}
				description={m.prompts_empty_body()}
				actionLabel={m.prompts_add()}
				onAction={() => (showAddPrompt = true)}
				variant="dashed"
				size="lg"
			/>
		{:else}
			{@const groupedPrompts = prompts.reduce(
				(acc, prompt) => {
					if (!acc[prompt.category]) acc[prompt.category] = [];
					acc[prompt.category].push(prompt);
					return acc;
				},
				{} as Record<string, Prompt[]>
			)}

			<div class="space-y-6">
				{#each Object.entries(groupedPrompts) as [category, categoryPrompts] (category)}
					<section>
						<h2 class="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
							{category}
						</h2>
						<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{#each categoryPrompts as prompt (prompt.id)}
								<article
									class="group flex flex-col rounded-md border bg-card transition-colors hover:border-accent"
								>
									<button
										type="button"
										class="flex-1 rounded-t-md p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
										onclick={() => usePrompt(prompt)}
									>
										<p
											class="line-clamp-3 text-sm leading-relaxed text-foreground/80 group-hover:text-foreground"
										>
											{prompt.text}
										</p>
										{#if prompt.example}
											<p
												class="mt-2 line-clamp-3 border-t pt-2 text-xs leading-relaxed text-muted-foreground group-hover:text-muted-foreground/80"
											>
												<span class="font-medium">{m.prompts_example_label()}:</span>
												{prompt.example}
											</p>
										{/if}
									</button>
									<div
										class="flex min-h-10 w-full items-center justify-between border-t px-3 py-1.5"
									>
										<span class="text-xs text-muted-foreground">
											{prompt.is_built_in ? m.prompts_built_in() : m.prompts_custom()}
										</span>
										{#if !prompt.is_built_in}
											<Button
												variant="ghost"
												size="icon-sm"
												class="text-muted-foreground hover:text-destructive"
												onclick={() => requestDeletePrompt(prompt)}
												aria-label={m.prompts_delete()}
											>
												<TrashIcon class="size-3.5" />
											</Button>
										{/if}
									</div>
								</article>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{/if}

		<Dialog.Root bind:open={showAddPrompt}>
			<Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
				<form
					onsubmit={(event) => {
						event.preventDefault();
						void addPrompt();
					}}
				>
					<Dialog.Header>
						<Dialog.Title>{m.prompts_add_title()}</Dialog.Title>
						<Dialog.Description>{m.prompts_description()}</Dialog.Description>
					</Dialog.Header>
					<div class="space-y-4 py-4">
						<div class="space-y-2">
							<label class="text-sm font-medium" for="prompt-text">{m.prompts_text()}</label>
							<Textarea
								id="prompt-text"
								bind:value={newPromptText}
								placeholder={m.prompts_text_placeholder()}
								rows={3}
							/>
						</div>
						<div class="space-y-2">
							<label class="text-sm font-medium" for="prompt-example">{m.prompts_example()}</label>
							<Textarea
								id="prompt-example"
								bind:value={newPromptExample}
								placeholder={m.prompts_example_placeholder()}
								rows={4}
							/>
							<p class="text-xs text-muted-foreground">{m.prompts_example_hint()}</p>
						</div>
						<div class="space-y-2">
							<label class="text-sm font-medium" for="prompt-category">{m.prompts_category()}</label
							>
							{#if loadingCategories && categories.length === 0}
								<Skeleton class="h-9 w-full" />
							{:else}
								<Select.Root
									type="single"
									value={newPromptCategory}
									onValueChange={(v) => (newPromptCategory = v)}
								>
									<Select.Trigger id="prompt-category" class="w-full">
										{newPromptCategory || m.prompts_select_category()}
									</Select.Trigger>
									<Select.Content>
										{#each categories as category (category)}
											<Select.Item value={category}>{category}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							{/if}
						</div>
					</div>
					<Dialog.Footer>
						<Button onclick={() => (showAddPrompt = false)} variant="outline"
							>{m.common_cancel()}</Button
						>
						<Button
							type="submit"
							disabled={!newPromptText.trim() || !newPromptCategory || submitting}
						>
							{#if submitting}
								<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
							{/if}
							{m.prompts_add()}
						</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	</div>
</PageContainer>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.prompts_delete_title()}
	description={m.prompts_delete_body()}
	confirmLabel={m.prompts_delete()}
	onConfirm={deletePrompt}
/>
