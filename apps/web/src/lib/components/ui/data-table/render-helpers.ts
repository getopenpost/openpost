import type { Component, ComponentProps, Snippet } from 'svelte';

export class RenderComponentConfig<TComponent extends Component> {
	component: TComponent;
	props: ComponentProps<TComponent> | Record<string, never>;

	constructor(
		component: TComponent,
		props: ComponentProps<TComponent> | Record<string, never> = {}
	) {
		this.component = component;
		this.props = props;
	}
}

export class RenderSnippetConfig<TProps> {
	snippet: Snippet<[TProps]>;
	params: TProps;

	constructor(snippet: Snippet<[TProps]>, params: TProps) {
		this.snippet = snippet;
		this.params = params;
	}
}

export function renderComponent<T extends Component<any>, Props extends ComponentProps<T>>(
	component: T,
	props: Props
) {
	return new RenderComponentConfig(component, props);
}

export function renderSnippet<TProps>(snippet: Snippet<[TProps]>, params: TProps) {
	return new RenderSnippetConfig(snippet, params);
}
