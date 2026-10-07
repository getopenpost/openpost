import { getContext, setContext } from "svelte";

export type UiMessages = {
  calendar_next: () => string;
  calendar_previous: () => string;
  calendar_label: () => string;
  common_close: () => string;
  common_toggle_sidebar: () => string;
  common_mobile_sidebar_description: () => string;
  common_sidebar: () => string;
};
const messagesKey = Symbol("openpost-ui-messages");
const english: UiMessages = {
  calendar_next: () => "Next month",
  calendar_previous: () => "Previous month",
  calendar_label: () => "Calendar",
  common_close: () => "Close",
  common_toggle_sidebar: () => "Toggle sidebar",
  common_mobile_sidebar_description: () => "Displays the mobile sidebar.",
  common_sidebar: () => "Sidebar",
};
export function provideUiMessages(messages: Partial<UiMessages>) {
  setContext(messagesKey, { ...english, ...messages });
}
export function getUiMessages(): UiMessages {
  return getContext<UiMessages>(messagesKey) ?? english;
}
