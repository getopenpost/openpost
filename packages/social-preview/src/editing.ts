import { getContext, setContext, type Snippet } from "svelte";
import type { PreviewCard, PreviewPoll, PreviewSegment } from "./model";

export interface PreviewEditing {
  text: Snippet<[PreviewSegment]>;
  title?: Snippet<[string, PreviewSegment]>;
  card?: Snippet<[PreviewCard, PreviewSegment, Snippet]>;
  poll?: Snippet<[PreviewPoll, PreviewSegment, Snippet]>;
}

const editingContext = Symbol("social-preview-editing");

export function providePreviewEditing(resolve: () => PreviewEditing | undefined) {
  setContext(editingContext, resolve);
}

export function previewEditing(): () => PreviewEditing | undefined {
  return getContext<() => PreviewEditing | undefined>(editingContext) ?? (() => undefined);
}
