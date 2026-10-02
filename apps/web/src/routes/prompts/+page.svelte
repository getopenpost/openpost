<script lang="ts">
	import { client } from '$lib/api/client';
	import type { operations } from '$lib/api/types';
	import { ThemeIcon, ProtectedIcon } from '$lib/themes/icons';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		promptCategoriesQueryOptions,
		promptQueryKeys,
		promptsQueryOptions,
		type Prompt
	} from '@openpost/query-catalog';
	import { queryClient } from '$lib/query/client';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent,
		settleQueryMutationSession,
		type QueryMutationSession
	} from '$lib/query/authorization-boundary';
	import { reconcileQueryMutation } from '$lib/query/mutation-reconciliation';
	import { promptQueryAPI } from '$lib/query/prompts';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { auth } from '$lib/stores/auth';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import PageContainer from '$lib/components/page-container.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages';
	type PromptsQueryParams = NonNullable<operations['get-random-prompt']['parameters']['query']>;

	let selectedCategory = $state<string>('all');
	let randomPrompt = $state.raw<Prompt | null>(null);
	let randomLoading = $state(false);
	let randomSequence = 0;
	let showAddPrompt = $state(false);
	let editingPrompt = $state.raw<Prompt | null>(null);
	let editorContent = $state<HTMLDivElement | null>(null);
	let categoryFilter = $state<HTMLButtonElement | null>(null);
	let editorOrigin: {
		target: EventTarget | null;
		workspaceID: string;
		session: QueryMutationSession;
	} | null = null;
	let newPromptText = $state('');
	let newPromptExample = $state('');
	let newPromptCategory = $state('');
	let submitting = $state(false);
	let toastMessage = $state('');
	let toastTone = $state<'success' | 'error'>('success');
	let deleteDialogOpen = $state(false);
	let promptToDelete = $state.raw<Prompt | null>(null);
	let mutationSequence = 0;
	let mutationWorkspaceID = '';
	let mutationActorID = '';
	const workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');

	interface PromptMutationView {
		readonly session: QueryMutationSession;
		readonly sequence: number;
		readonly workspaceID: string;
	}
	const promptsQuery = createQuery(() => ({
		...promptsQueryOptions(
			promptQueryAPI,
			workspaceID,
			selectedCategory === 'all' ? '' : selectedCategory
		),
		placeholderData: (previousData, previousQuery) =>
			previousQuery?.queryKey[3] === workspaceID ? previousData : undefined
	}));
	const categoriesQuery = createQuery(() => promptCategoriesQueryOptions(promptQueryAPI));
	const prompts = $derived<Prompt[]>(promptsQuery.data ?? []);
	const hasPromptData = $derived(promptsQuery.data !== undefined);
	const categories = $derived(categoriesQuery.data ?? []);
	const loading = $derived(promptsQuery.isFetching);
	const hasCategoryData = $derived(categoriesQuery.data !== undefined);
	const routeLoading = $derived(
		!workspaceCtx.currentWorkspace ||
			promptsQuery.isPending ||
			(categoriesQuery.isPending && !hasCategoryData)
	);
	const error = $derived(queryErrorMessage(promptsQuery.error, m.prompts_load_failed()));
	const categoriesError = $derived(
		queryErrorMessage(categoriesQuery.error, m.prompts_load_failed())
	);

	$effect(() => {
		const actorID = $auth.user?.id ?? '';
		if (mutationWorkspaceID === workspaceID && mutationActorID === actorID) return;
		mutationWorkspaceID = workspaceID;
		mutationActorID = actorID;
		mutationSequence += 1;
		randomSequence += 1;
		randomPrompt = null;
		randomLoading = false;
		showAddPrompt = false;
		editingPrompt = null;
		editorOrigin = null;
		newPromptText = '';
		newPromptExample = '';
		newPromptCategory = '';
		submitting = false;
		toastMessage = '';
		deleteDialogOpen = false;
		promptToDelete = null;
	});

	function capturePromptMutationView(): PromptMutationView {
		return {
			session: captureQueryMutationSession(),
			sequence: ++mutationSequence,
			workspaceID
		};
	}

	function promptMutationViewIsCurrent(view: PromptMutationView): boolean {
		return (
			view.sequence === mutationSequence &&
			view.workspaceID === workspaceID &&
			queryMutationSessionIsCurrent(view.session)
		);
	}

	function canEditPrompt(prompt: Prompt): boolean {
		if (prompt.is_built_in) return false;
		const isCreator = prompt.user_id === $auth.user?.id;
		if (!prompt.workspace_id) return isCreator;
		const workspace = workspaceCtx.currentWorkspace;
		return Boolean(
			workspace?.id === prompt.workspace_id &&
			workspace.can_edit &&
			(isCreator || workspace.role === 'admin')
		);
	}

	function openPromptEditor(prompt: Prompt | null, event?: MouseEvent) {
		if (prompt && !canEditPrompt(prompt)) return;
		mutationSequence += 1;
		editingPrompt = prompt;
		newPromptText = prompt?.text ?? '';
		newPromptExample = prompt?.example ?? '';
		newPromptCategory = prompt?.category ?? categories[0] ?? '';
		editorOrigin = {
			target: event?.currentTarget ?? null,
			workspaceID,
			session: captureQueryMutationSession()
		};
		submitting = false;
		showAddPrompt = true;
	}

	function closePromptEditor() {
		mutationSequence += 1;
		submitting = false;
		showAddPrompt = false;
	}

	function restorePromptEditorFocus(event: Event) {
		event.preventDefault();
		if (
			!editorOrigin ||
			editorOrigin.workspaceID !== workspaceID ||
			!queryMutationSessionIsCurrent(editorOrigin.session)
		)
			return;
		const active = document.activeElement;
		if (active && active !== document.body && !editorContent?.contains(active)) return;
		const target = editorOrigin.target;
		if (target instanceof HTMLElement && target.isConnected) target.focus();
		else categoryFilter?.focus();
	}

	async function savePrompt() {
		if (!workspaceCtx.currentWorkspace || !newPromptText.trim() || !newPromptCategory) return;
		const view = capturePromptMutationView();
		const target = editingPrompt;
		const text = newPromptText.trim();
		const example = newPromptExample.trim();
		const category = newPromptCategory;
		submitting = true;
		try {
			const result = target
				? await client.PUT('/prompts/{id}', {
						params: { path: { id: target.id } },
						body: { text, example, category }
					})
				: await client.POST('/prompts', {
						body: { workspace_id: view.workspaceID, text, example, category }
					});
			const { error: err, response } = result;
			settleQueryMutationSession(view.session, response);
			if (err)
				throw new Error(
					err.detail || (target ? m.prompts_save_failed() : m.prompts_create_failed())
				);
			const reconciled = await reconcileQueryMutation(queryClient, view.session, {
				invalidate: [{ queryKey: promptQueryKeys.lists(view.workspaceID) }]
			});
			if (!reconciled || !promptMutationViewIsCurrent(view)) return;
			if (target && randomPrompt?.id === target.id && result.data) randomPrompt = result.data;
			showAddPrompt = false;
			newPromptText = '';
			newPromptExample = '';
			toastTone = 'success';
			toastMessage = target ? m.prompts_saved() : m.prompts_created();
		} catch (e) {
			if (!promptMutationViewIsCurrent(view)) return;
			toastTone = 'error';
			toastMessage =
				e instanceof Error
					? e.message
					: target
						? m.prompts_save_failed()
						: m.prompts_create_failed();
		} finally {
			if (view.sequence === mutationSequence) submitting = false;
		}
	}

	function requestDeletePrompt(prompt: Prompt) {
		promptToDelete = prompt;
		deleteDialogOpen = true;
	}

	async function deletePrompt(): Promise<DestructiveActionOutcome> {
		const prompt = promptToDelete;
		if (!prompt) return { ok: false };
		const view = capturePromptMutationView();
		try {
			const { error: err, response } = await client.DELETE('/prompts/{id}', {
				params: { path: { id: prompt.id } }
			});
			settleQueryMutationSession(view.session, response);
			if (err) throw new Error(err.detail || m.prompts_delete_failed());
			const reconciled = await reconcileQueryMutation(queryClient, view.session, {
				invalidate: [{ queryKey: promptQueryKeys.lists(view.workspaceID) }]
			});
			if (!reconciled || !promptMutationViewIsCurrent(view)) return { ok: false };
			promptToDelete = null;
			return { ok: true, successMessage: m.prompts_deleted() };
		} catch (e) {
			if (!promptMutationViewIsCurrent(view)) return { ok: false };
			return {
				ok: false,
				message: e instanceof Error ? e.message : m.prompts_delete_failed()
			};
		}
	}

	async function getRandomPrompt() {
		if (!workspaceID || randomLoading) return;
		const session = captureQueryMutationSession();
		const sequence = ++randomSequence;
		const selectedWorkspace = workspaceID;
		const category = selectedCategory;
		const isCurrent = () =>
			sequence === randomSequence &&
			selectedWorkspace === workspaceID &&
			category === selectedCategory &&
			queryMutationSessionIsCurrent(session);
		randomLoading = true;
		try {
			const params: PromptsQueryParams = { workspace_id: selectedWorkspace };
			if (category !== 'all') params.category = category;
			const { data, error: err } = await client.GET('/prompts/random', {
				params: { query: params }
			});
			if (!isCurrent()) return;
			if (err) throw new Error(err.detail || m.prompts_random_failed());
			if (!data) throw new Error(m.prompts_random_failed());
			randomPrompt = data;
		} catch (e) {
			if (!isCurrent()) return;
			toastTone = 'error';
			toastMessage = e instanceof Error ? e.message : m.prompts_random_failed();
		} finally {
			if (sequence === randomSequence) randomLoading = false;
		}
	}

	function usePrompt(prompt: Prompt) {
		ui.setPrompt({ text: prompt.text, example: prompt.example ?? '' });
		goto(resolve('/'));
	}

	$effect(() => {
		if (categories.length > 0 && !newPromptCategory) newPromptCategory = categories[0];
	});

	function queryErrorMessage(cause: unknown, fallback: string) {
		return cause instanceof Error ? cause.message : cause ? fallback : '';
	}
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
	themeIconRole="idea"
	loading={routeLoading}
	loadingMessage={m.common_loading()}
	loadingLayout="grid"
>
	{#snippet actions()}
		<Select.Root
			type="single"
			value={selectedCategory}
			onValueChange={(value) => {
				selectedCategory = value;
				randomSequence += 1;
				randomPrompt = null;
				randomLoading = false;
			}}
		>
			<Select.Trigger bind:ref={categoryFilter} class="w-40">
				{selectedCategory === 'all' ? m.prompts_all_categories() : selectedCategory}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all">{m.prompts_all_categories()}</Select.Item>
				{#each categories as category (category)}
					<Select.Item value={category}>{category}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<Button
			onclick={getRandomPrompt}
			variant="outline"
			class="gap-2"
			disabled={!workspaceID}
			aria-disabled={randomLoading}
			aria-busy={randomLoading}
		>
			<ProtectedIcon icon="editor-shuffle" class="size-4" />
			{m.prompts_random()}
		</Button>
		<Button onclick={(event) => openPromptEditor(null, event)} class="gap-2">
			<ThemeIcon role="add" class="size-4" />
			{m.prompts_add()}
		</Button>
	{/snippet}

	<div class="space-y-6">
		{#if randomLoading}
			<p class="text-sm text-muted-foreground" role="status">{m.common_loading()}</p>
		{/if}
		{#if randomPrompt}
			<section
				class="rounded-md border bg-card p-4"
				aria-label={m.compose_writing_prompt()}
				aria-live="polite"
			>
				<h2 class="text-sm font-semibold">{m.compose_writing_prompt()}</h2>
				<p class="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{randomPrompt.text}</p>
				{#if randomPrompt.example}
					<div class="mt-3 border-t pt-3">
						<h3 class="text-xs font-medium text-muted-foreground">{m.prompts_example_label()}</h3>
						<p class="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{randomPrompt.example}</p>
					</div>
				{/if}
				<Button class="mt-3 gap-2" onclick={() => randomPrompt && usePrompt(randomPrompt)}>
					<ThemeIcon role="add" class="size-4" />{m.sidebar_new_post()}
				</Button>
			</section>
		{/if}
		{#if categoriesError}
			<InlineNotice tone="error" message={categoriesError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => void categoriesQuery.refetch()}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{/if}
		{#if error}
			<InlineNotice tone="error" message={error}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => void promptsQuery.refetch()}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{/if}

		<!-- Prompts Grid -->
		{#if loading && hasPromptData}
			<span class="sr-only" role="status">{m.common_loading()}</span>
		{/if}
		{#if hasPromptData && prompts.length === 0}
			<EmptyState
				themeIconRole="idea"
				title={m.prompts_empty()}
				description={m.prompts_empty_body()}
				actionLabel={m.prompts_add()}
				onAction={() => openPromptEditor(null)}
				variant="dashed"
				size="lg"
			/>
		{:else if hasPromptData}
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
										<div class="flex items-center gap-1">
											{#if canEditPrompt(prompt)}
												<Button
													variant="ghost"
													size="icon-sm"
													onclick={(event) => openPromptEditor(prompt, event)}
													aria-label={m.prompts_edit_title()}
												>
													<ThemeIcon role="edit" class="size-3.5" />
												</Button>
											{/if}
											{#if !prompt.is_built_in}
												<Button
													variant="ghost"
													size="icon-sm"
													class="text-muted-foreground hover:text-destructive"
													onclick={() => requestDeletePrompt(prompt)}
													aria-label={m.prompts_delete()}
												>
													<ThemeIcon role="delete" class="size-3.5" />
												</Button>
											{/if}
										</div>
									</div>
								</article>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{/if}

		<Dialog.Root
			bind:open={showAddPrompt}
			onOpenChange={(open) => {
				if (!open) closePromptEditor();
			}}
		>
			<Dialog.Content
				bind:ref={editorContent}
				onCloseAutoFocus={restorePromptEditorFocus}
				class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
			>
				<form
					onsubmit={(event) => {
						event.preventDefault();
						void savePrompt();
					}}
				>
					<Dialog.Header>
						<Dialog.Title
							>{editingPrompt ? m.prompts_edit_title() : m.prompts_add_title()}</Dialog.Title
						>
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
						</div>
					</div>
					<Dialog.Footer>
						<Button onclick={closePromptEditor} variant="outline">{m.common_cancel()}</Button>
						<Button
							type="submit"
							disabled={!newPromptText.trim() || !newPromptCategory || submitting}
						>
							{#if submitting}
								<ProtectedIcon icon="loading" class="mr-2 h-4 w-4 animate-spin" />
							{/if}
							{editingPrompt ? m.common_save() : m.prompts_add()}
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
