<script lang="ts">
	import { onMount, mount, unmount, untrack } from 'svelte';
	import { Editor } from '@tiptap/core';
	import { shift } from '@floating-ui/dom';
	import { IsUsingKeyboard } from 'bits-ui';
	import Document from '@tiptap/extension-document';
	import Paragraph from '@tiptap/extension-paragraph';
	import Text from '@tiptap/extension-text';
	import HardBreak from '@tiptap/extension-hard-break';
	import Mention from '@tiptap/extension-mention';
	import { UndoRedo, Placeholder } from '@tiptap/extensions';
	import { PluginKey } from '@tiptap/pm/state';
	import { exitSuggestion, type SuggestionProps } from '@tiptap/suggestion';
	import { postTextDocument, postTextValue } from '../post-text.js';
	import {
		readMentionMetadata,
		type MentionCandidate,
		type PostTextValue
	} from '@openpost/platform-text/mentions';
	import { getUiMessages } from '../messages.js';
	import MentionList from './mention-list.svelte';

	let {
		id,
		value,
		onchange,
		lookup,
		mentionScope,
		disabled = false,
		placeholder = '',
		label,
		class: className = '',
		style = '',
		onpaste,
		onfocus,
		minimumQueryLength = 2,
		oncreate
	}: {
		id: string;
		value: PostTextValue;
		onchange: (value: PostTextValue) => void;
		lookup?: (query: string, signal: AbortSignal) => Promise<MentionCandidate[]>;
		mentionScope?: { provider: string; authority?: string };
		disabled?: boolean;
		placeholder?: string;
		label: string;
		class?: string;
		style?: string;
		onpaste?: (event: ClipboardEvent) => void;
		onfocus?: () => void;
		minimumQueryLength?: number;
		oncreate?: (query: string, complete: (candidate: MentionCandidate) => void) => void;
	} = $props();
	const messages = getUiMessages();
	const componentID = $props.id();
	const popupID = `${componentID}-mentions`;
	const suggestionKey = new PluginKey(popupID);
	let element: HTMLDivElement;
	let editor = $state<Editor>();
	const keyboard = new IsUsingKeyboard();
	let pending: AbortController | undefined;
	let editorError = $state('');
	let currentQuery = '';
	let currentSuggestion: SuggestionProps<MentionCandidate> | undefined;
	const list = $state({
		items: [] as MentionCandidate[],
		selected: 0,
		error: '',
		loading: false,
		hint: '',
		create: undefined as (() => void) | undefined,
		choose,
		retry: () => {
			void retry();
		}
	});
	function choose(index: number) {
		if (index === list.items.length && oncreate && currentSuggestion && editor) {
			const instance = editor;
			const range = { ...currentSuggestion.range };
			const document = instance.state.doc;
			const query = currentSuggestion.query;
			exitSuggestion(instance.view, suggestionKey);
			oncreate(query, (candidate) => {
				if (instance.isDestroyed || !instance.state.doc.eq(document)) return;
				if (postTextValue(instance.getJSON()).mentions.length >= 50) {
					editorError = messages.editor_mention_limit();
					return;
				}
				instance.chain().focus().insertContentAt(range, [
					{ type: 'mention', attrs: { id: candidate.target.id, label: candidate.label, identity: candidate.target } },
					{ type: 'text', text: ' ' }
				]).run();
			});
			return;
		}
		const item = list.items[index];
		if (postTextValue(editor!.getJSON()).mentions.length >= 50) {
			list.error = messages.editor_mention_limit();
			return;
		}
		if (item && currentSuggestion)
			currentSuggestion.command({ id: item.target.id, label: item.label, identity: item.target });
	}
	async function search(query: string) {
		pending?.abort();
		const controller = new AbortController();
		pending = controller;
		currentQuery = query;
		list.loading = true;
		list.error = '';
		list.hint = query.trim().length < minimumQueryLength ? messages.editor_search_characters() : '';
		if (!lookup || query.trim().length < minimumQueryLength) {
			list.loading = false;
			return [];
		}
		try {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(resolve, 180);
				controller.signal.addEventListener(
					'abort',
					() => {
						clearTimeout(timer);
						reject(controller.signal.reason);
					},
					{ once: true }
				);
			});
			const items = await lookup(query, controller.signal);
			return controller.signal.aborted ? [] : items;
		} catch (error) {
			const status =
				error && typeof error === 'object' && 'status' in error ? error.status : undefined;
			const kind = status === 403 ? 'permission_required' : status === 429 ? 'rate_limited' : '';
			if (!controller.signal.aborted)
				list.error =
					kind === 'permission_required'
						? messages.editor_permission_required()
						: kind === 'rate_limited'
							? messages.editor_rate_limited()
							: messages.editor_lookup_failed();
			return [];
		} finally {
			if (pending === controller) list.loading = false;
		}
	}
	async function retry() {
		const query = currentQuery;
		const items = await search(query);
		if (currentSuggestion && query === currentQuery) {
			list.items = items;
			list.selected = 0;
		}
	}
	function updateSuggestion(props: SuggestionProps<MentionCandidate>) {
		currentSuggestion = props;
		list.create = oncreate ? () => choose(list.items.length) : undefined;
		list.items = props.items;
		list.selected = 0;
		editor?.view.dom.setAttribute('aria-controls', popupID);
		updateActive();
	}
	function updateActive() {
		const dom = editor?.view.dom;
		if (list.items[list.selected] || (list.selected === list.items.length && list.create))
			dom?.setAttribute('aria-activedescendant', `${popupID}-${list.selected}`);
		else dom?.removeAttribute('aria-activedescendant');
	}

	const clipboardType = 'application/x-openpost-post-text+json';
	function copySelection(event: ClipboardEvent, cut = false) {
		if (!editor || !event.clipboardData || editor.state.selection.empty) return false;
		const content = editor.state.selection.content().content.toJSON();
		const selected = postTextValue({ type: 'doc', content });
		event.clipboardData.setData('text/plain', selected.body);
		event.clipboardData.setData(clipboardType, JSON.stringify(selected));
		event.preventDefault();
		if (cut) editor.commands.deleteSelection();
		return true;
	}
	function pastedValue(event: ClipboardEvent): PostTextValue {
		const body = event.clipboardData?.getData('text/plain') ?? '';
		const raw = event.clipboardData?.getData(clipboardType) ?? '';
		if (!raw) return { body, mentions: [] };
		if (raw.length >= 1024 * 1024) throw new Error('account');
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed.mentions) && parsed.mentions.length > 50) throw new Error('limit');
		const metadata = readMentionMetadata(body, { version: 1, spans: parsed.mentions });
		if (parsed.body !== body || !metadata) throw new Error('account');
		if (
			metadata.spans.some(
				(span) =>
					mentionScope &&
					span.target.provider !== 'workspace' &&
					(span.target.provider !== mentionScope.provider ||
						(span.target.provider === 'mastodon' &&
							span.target.authority?.replace(/\/$/, '').toLowerCase() !==
								mentionScope.authority?.replace(/\/$/, '').toLowerCase()))
			)
		)
			throw new Error('account');
		return { body, mentions: metadata.spans };
	}
	onMount(() => {
		const Mentions = Mention.extend({
			addAttributes() {
				return { ...this.parent?.(), identity: { default: null, rendered: false } };
			},
			addKeyboardShortcuts() {
				return {
					Backspace: () =>
						this.editor.commands.command(({ tr, state }) => {
							if (!state.selection.empty) return false;
							const before = state.selection.$anchor.nodeBefore;
							if (before?.type.name !== this.name) return false;
							tr.insertText(
								String(before.attrs.label ?? ''),
								state.selection.from - before.nodeSize,
								state.selection.from
							);
							return true;
						})
				};
			}
		}).configure({
			renderText: ({ node }) => String(node.attrs.label ?? ''),
			renderHTML: ({ node }) => [
				'span',
				{ 'data-mention': 'true', class: 'rounded-sm bg-primary/10 text-primary' },
				String(node.attrs.label ?? '')
			],
			suggestion: {
				pluginKey: suggestionKey,
				floatingUi: { middleware: [shift({ padding: 8 })] },
				allow: () => !!lookup && !disabled,
				items: ({ query }) => search(query),
				render: () => {
					let destroyPosition: (() => void) | undefined;
					let component: ReturnType<typeof mount> | undefined;
					let popup: HTMLDivElement | undefined;
					return {
						onStart(props) {
							updateSuggestion(props);
							popup = document.createElement('div');
							popup.style.zIndex = '80';
							component = mount(MentionList, {
								target: popup,
								props: { state: list, id: popupID, m: messages }
							});
							destroyPosition = props.mount(popup);
						},
						onUpdate: updateSuggestion,
						onKeyDown({ event }) {
							if (event.key === 'Escape') {
								exitSuggestion(editor!.view, suggestionKey);
								return true;
							}
							if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
								const size = list.items.length + (oncreate ? 1 : 0);
								if (!size) return false;
									list.selected =
									(list.selected + (event.key === 'ArrowDown' ? 1 : -1) + size) % size;
								updateActive();
								document
									.getElementById(`${popupID}-${list.selected}`)
									?.scrollIntoView({ block: 'nearest' });
								return true;
							}
							if ((event.key === 'Enter' || event.key === 'Tab') && (list.items.length || oncreate)) {
								choose(list.selected);
								return true;
							}
							return false;
						},
						onExit() {
							pending?.abort();
							currentSuggestion = undefined;
							destroyPosition?.();
							if (component) void unmount(component);
							popup?.remove();
							editor?.view.dom.removeAttribute('aria-controls');
							editor?.view.dom.removeAttribute('aria-activedescendant');
						}
					};
				}
			}
		});
		const instance = new Editor({
			element,
			editable: !disabled,
			content: postTextDocument(untrack(() => value)),
			extensions: [
				Document.extend({ content: 'paragraph+' }),
				Paragraph,
				Text,
				HardBreak,
				UndoRedo,
				Placeholder.configure({ placeholder: () => placeholder }),
				Mentions
			],
			editorProps: {
				attributes: {
					id,
					role: 'textbox',
					'aria-multiline': 'true',
					'aria-label': label,
					dir: 'auto',
					class: className,
					style,
					'aria-autocomplete': 'list'
				},
				handleDOMEvents: {
					pointerdown: (view) => {
						view.dom.removeAttribute('data-keyboard-focus');
						return false;
					},
					copy: (_view, event) => copySelection(event),
					cut: (_view, event) => copySelection(event, true)
				},
				handlePaste(_view, event) {
					onpaste?.(event);
					if (event.defaultPrevented) return true;
					const text = event.clipboardData?.getData('text/plain');
					if (text !== undefined) {
						try {
							const pasted = pastedValue(event);
							const retained =
								postTextValue(instance.state.doc.cut(0, instance.state.selection.from).toJSON())
									.mentions.length +
								postTextValue(instance.state.doc.cut(instance.state.selection.to).toJSON()).mentions
									.length;
							if (retained + (pasted.mentions?.length ?? 0) > 50) throw new Error('limit');
							instance.commands.insertContent(postTextDocument(pasted).content?.[0]?.content ?? []);
							editorError = '';
						} catch (error) {
							editorError =
								error instanceof Error && error.message === 'limit'
									? messages.editor_mention_limit()
									: messages.editor_mention_account_required();
						}
						return true;
					}
					return false;
				},
				handleKeyDown(_view, event) {
					if (event.key === 'Enter' && !event.isComposing && !currentSuggestion) {
						instance.commands.setHardBreak();
						return true;
					}
					const mac = /Mac|iPhone|iPad/.test(navigator.platform);
					if ((mac ? event.metaKey : event.ctrlKey) && ['b', 'i', 'u'].includes(event.key.toLowerCase()))
						return true;
					return false;
				}
			},
			onFocus: ({ editor }) => {
				if (keyboard.current) editor.view.dom.setAttribute('data-keyboard-focus', 'true');
				onfocus?.();
			},
			onBlur: ({ editor }) => editor.view.dom.removeAttribute('data-keyboard-focus'),
			onUpdate: ({ editor }) => {
				const next = postTextValue(editor.getJSON());
				onchange(
					next.mentions.length > 0 || value.mentions !== undefined ? next : { body: next.body }
				);
			}
		});
		editor = instance;
		return () => {
			pending?.abort();
			instance.destroy();
		};
	});
	$effect(() => {
		const instance = editor;
		if (!instance) return;
		const next = value;
		untrack(() => {
			if (
				JSON.stringify(postTextValue(instance.getJSON())) !==
				JSON.stringify({ body: next.body, mentions: next.mentions ?? [] })
			)
				instance.commands.setContent(postTextDocument(next), { emitUpdate: false });
		});
	});
	$effect(() => {
		editor?.setEditable(!disabled, false);
	});
	$effect(() => {
		if (editor) {
			editor.view.dom.id = id;
			editor.view.dom.className = `tiptap ProseMirror ${className} ${editor.isFocused ? 'ProseMirror-focused' : ''}`;
			editor.view.dom.style.cssText = style;
			editor.view.dom.setAttribute('aria-label', label);
			editor.view.dom.setAttribute('aria-disabled', String(disabled));
		}
	});
	export function focus() {
		editor?.commands.focus();
	}
	export function insertText(text: string) {
		editor?.commands.insertContent(
			postTextDocument({ body: text, mentions: [] }).content?.[0]?.content ?? []
		);
	}
</script>

<div bind:this={element} class="post-editor min-w-0" class:opacity-60={disabled}></div>
{#if editorError}<p role="alert" class="text-sm text-destructive">{editorError}</p>{/if}

<style>
	.post-editor :global(.tiptap) {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		min-height: 44px;
		outline: none;
	}
	.post-editor :global(.tiptap[data-keyboard-focus='true']) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.post-editor :global(p) {
		margin: 0;
	}
	/* An empty dir="auto" editor resolves to LTR; align an RTL UI placeholder to inline-start. */
	.post-editor:dir(rtl) :global(.is-editor-empty:first-child) {
		direction: rtl;
	}
	.post-editor :global(.is-editor-empty:first-child::before) {
		color: var(--muted-foreground);
		content: attr(data-placeholder);
		float: inline-start;
		height: 0;
		pointer-events: none;
	}
	.post-editor :global([data-mention]) {
		box-decoration-break: clone;
	}
</style>
