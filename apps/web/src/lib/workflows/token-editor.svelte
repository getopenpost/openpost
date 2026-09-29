<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorState, Compartment } from '@codemirror/state';
	import {
		EditorView,
		Decoration,
		WidgetType,
		ViewPlugin,
		MatchDecorator,
		keymap,
		placeholder as editorPlaceholder
	} from '@codemirror/view';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { autocompletion } from '@codemirror/autocomplete';
	import { javascript } from '@codemirror/lang-javascript';
	import { referenceExists } from './validation';
	import type { Reference } from './fields';
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import * as Command from '$lib/components/ui/command';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	let {
		id,
		label,
		value,
		onchange,
		references = [],
		code = false,
		multiline = true,
		invalid = false,
		placeholder = '',
		readonly = false
	}: {
		readonly?: boolean;
		id: string;
		label: string;
		value: string;
		onchange: (value: string) => void;
		references?: Reference[];
		code?: boolean;
		multiline?: boolean;
		invalid?: boolean;
		placeholder?: string;
	} = $props();
	let element: HTMLDivElement;
	let view: EditorView | undefined;
	let syntax = $state(false);
	let variablesOpen = $state(false);
	let returnToEditor = false;
	const configuration = new Compartment();
	class Token extends WidgetType {
		reference: string;
		title: string;
		valid: boolean;
		constructor(reference: string, title: string, valid: boolean) {
			super();
			this.reference = reference;
			this.title = title;
			this.valid = valid;
		}

		eq(other: Token) {
			return (
				this.reference === other.reference &&
				this.title === other.title &&
				this.valid === other.valid
			);
		}
		toDOM() {
			const span = document.createElement('span');
			span.className = `workflow-token ${this.valid ? '' : 'workflow-token-invalid'}`;
			span.textContent = this.title;
			span.title = this.reference;
			span.setAttribute('aria-label', this.reference);
			return span;
		}
	}
	function extensions() {
		const refs = references;
		const matcher = new MatchDecorator({
			regexp: /\{\{\s*([a-zA-Z][a-zA-Z0-9_.-]*)\s*\}\}/g,
			decoration: (match) =>
				Decoration.replace({
					widget: new Token(
						match[1],
						refs.find((ref) => ref.value === match[1])?.label ?? match[1],
						referenceExists(match[1], refs)
					)
				})
		});
		const tokens = ViewPlugin.fromClass(
			class {
				decorations;
				constructor(editor: EditorView) {
					this.decorations = matcher.createDeco(editor);
				}
				update(update: import('@codemirror/view').ViewUpdate) {
					this.decorations = matcher.updateDeco(update, this.decorations);
				}
			},
			{
				decorations: (instance) => instance.decorations,
				provide: (plugin) =>
					EditorView.atomicRanges.of(
						(editor) => editor.plugin(plugin)?.decorations ?? Decoration.none
					)
			}
		);
		return [
			EditorState.readOnly.of(readonly),
			EditorView.editable.of(!readonly),
			EditorView.contentAttributes.of({
				id,
				role: 'textbox',
				'aria-multiline': String(multiline),
				'aria-label': label,
				'aria-invalid': String(invalid),
				'aria-describedby': invalid ? `${id}-error` : ''
			}),
			...(code ? [javascript()] : syntax ? [] : [tokens]),
			...(code
				? []
				: [
						autocompletion({
							override: [
								(context) => {
									const match = context.matchBefore(/\{\{[\w. -]*/);
									if (!match && !context.explicit) return null;
									return {
										from: match?.from ?? context.pos,
										options: refs
											.filter(
												(ref) =>
													!match ||
													`${ref.label} ${ref.value}`
														.toLowerCase()
														.includes(match.text.slice(2).trim().toLowerCase())
											)
											.map((ref) => ({
												label: ref.value,
												displayLabel: ref.label,
												apply: `{{${ref.value}}}`,
												type: 'variable'
											})),
										filter: false
									};
								}
							]
						})
					]),
			editorPlaceholder(placeholder)
		];
	}
	onMount(() => {
		view = new EditorView({
			parent: element,
			state: EditorState.create({
				doc: value,
				extensions: [
					history(),
					keymap.of([...defaultKeymap, ...historyKeymap]),
					EditorView.lineWrapping,
					configuration.of(extensions()),
					EditorView.updateListener.of((update) => {
						if (update.docChanged) onchange(update.state.doc.toString());
					}),
					EditorView.domEventHandlers({
						drop(event, editor) {
							const ref = event.dataTransfer?.getData('application/openpost-workflow-reference');
							if (!ref || readonly || code) return false;
							event.preventDefault();
							const pos =
								editor.posAtCoords({ x: event.clientX, y: event.clientY }) ??
								editor.state.selection.main.head;
							editor.dispatch({
								changes: { from: pos, insert: `{{${ref}}}` },
								selection: { anchor: pos + ref.length + 4 }
							});
							editor.focus();
							return true;
						}
					})
				]
			})
		});
		return () => {
			view?.destroy();
			view = undefined;
		};
	});
	$effect(() => {
		const next = value;
		if (view && view.state.doc.toString() !== next)
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
	});
	$effect(() => {
		const updated = extensions();
		if (view) view.dispatch({ effects: configuration.reconfigure(updated) });
	});
	function insert(reference: string) {
		if (!view || readonly) return;
		view.dispatch(view.state.replaceSelection(`{{${reference}}}`));
		returnToEditor = true;
		variablesOpen = false;
	}
</script>

<div
	class="workflow-token-editor {multiline
		? ''
		: 'workflow-token-single'} overflow-hidden rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring {invalid
		? 'border-destructive'
		: 'border-input'}"
>
	<div bind:this={element} class="text-sm"></div>
	{#if !code && !readonly}<div class="flex items-center justify-between gap-2 border-t px-2 py-1">
			<Popover.Root bind:open={variablesOpen}>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button {...props} variant="ghost" size="sm" class="gap-1.5 px-1.5 text-xs">
							<ThemeIcon role="add" class="size-3.5" />{m.workflows_insert_variable()}
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content
					align="start"
					class="w-80 max-w-[calc(100vw-2rem)] p-0"
					onCloseAutoFocus={(event) => {
						if (!returnToEditor) return;
						returnToEditor = false;
						event.preventDefault();
						view?.focus();
					}}
				>
					<Command.Root>
						<Command.Input
							placeholder={m.workflows_search_variables()}
							aria-label={m.workflows_search_variables()}
						/>
						<Command.List>
							<Command.Empty>{m.workflows_no_match()}</Command.Empty>
							<Command.Group>
								{#each references as ref (ref.value)}
									<Command.Item
										value={`${ref.label} ${ref.value}`}
										onSelect={() => insert(ref.value)}
										class="min-h-9 [@media(pointer:coarse)]:min-h-11"
									>
										<span class="min-w-0"
											><span class="block truncate">{ref.label}</span><span
												class="block truncate text-[11px] text-muted-foreground">{ref.value}</span
											></span
										>
									</Command.Item>
								{/each}
							</Command.Group>
						</Command.List>
					</Command.Root>
				</Popover.Content>
			</Popover.Root>
			<Button
				size="icon-sm"
				variant="ghost"
				aria-label={syntax ? m.workflows_show_tokens() : m.workflows_show_source()}
				aria-pressed={syntax}
				onclick={() => (syntax = !syntax)}><span class="font-mono text-xs">{'{}'}</span></Button
			>
		</div>{/if}
</div>

<style>
	.workflow-token-editor :global(.cm-editor) {
		background: var(--background);
		color: var(--foreground);
	}
	.workflow-token-editor :global(.cm-content) {
		font-family: var(--font-sans);
		padding: 10px;
		min-height: 112px;
		caret-color: var(--foreground);
	}
	.workflow-token-single :global(.cm-content) {
		min-height: 36px;
		padding: 6px 10px;
	}
	.workflow-token-editor :global(.cm-scroller) {
		max-height: 320px;
		overflow: auto;
	}
	.workflow-token-editor :global(.cm-focused) {
		outline: none;
	}
	.workflow-token-editor :global(.cm-selectionBackground) {
		background: var(--accent) !important;
	}
	.workflow-token-editor :global(.cm-tooltip) {
		background: var(--popover);
		color: var(--popover-foreground);
		border-color: var(--border);
	}
	.workflow-token-editor :global(.workflow-token) {
		display: inline-block;
		margin: 1px 2px;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--accent);
		color: var(--accent-foreground);
		font-size: 12px;
		line-height: 20px;
		white-space: normal;
	}
	.workflow-token-editor :global(.workflow-token-invalid) {
		color: var(--destructive);
		text-decoration: underline wavy;
	}
	.workflow-token-editor :global(.cm-placeholder) {
		color: var(--muted-foreground);
	}
</style>
