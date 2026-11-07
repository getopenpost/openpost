import { getContext, setContext } from "svelte";

export type UiMessages = {
  editor_add_mention: () => string;
  editor_search_characters: () => string;
  editor_mention_limit: () => string;
  editor_mention_account_required: () => string;
  editor_permission_required: () => string;
  editor_rate_limited: () => string;

  editor_mentions: () => string;
  editor_searching: () => string;
  editor_no_matches: () => string;
  editor_lookup_failed: () => string;
  editor_retry: () => string;

  calendar_next: () => string;
  calendar_previous: () => string;
  calendar_label: () => string;
  color_picker_pick_from_screen: () => string;
  color_picker_brand_colors: () => string;
  color_picker_recent_colors: () => string;
  color_picker_hex_color: () => string;
  color_picker_hue: () => string;
  color_picker_saturation: () => string;
  color_picker_lightness: () => string;
  color_picker_opacity: () => string;
  common_close: () => string;
  common_toggle_sidebar: () => string;
  common_mobile_sidebar_description: () => string;
  common_sidebar: () => string;
  chart_keyboard_help: () => string;
  chart_category: () => string;
  chart_series: () => string;
  chart_spotlight: (label: string) => string;
  chart_slices: () => string;
  chart_value: () => string;
  chart_share: () => string;
  chart_slice_keyboard_help: () => string;
  chart_axis: () => string;
  chart_axis_keyboard_help: () => string;
  chart_less: () => string;
  chart_more: () => string;
  chart_none: () => string;
  chart_levels: () => string;
  chart_up_to: (value: string) => string;
  chart_more_than: (value: string) => string;
  chart_square_keyboard_help: () => string;
};
const messagesKey = Symbol("openpost-ui-messages");
const english: UiMessages = {
  editor_add_mention: () => "Add mention",
  editor_search_characters: () => "Type at least two characters to search.",
  editor_mention_limit: () => "A post can include at most 50 selected mentions.",
  editor_mention_account_required: () => "Choose mentions for this account, or paste plain text.",

  editor_permission_required: () =>
    "The provider has not granted mention search access. Check the account and app permissions.",
  editor_rate_limited: () => "Mention search is rate limited. Try again later.",

  editor_mentions: () => "Mentions",
  editor_searching: () => "Searching\u2026",
  editor_no_matches: () => "No matching accounts",
  editor_lookup_failed: () => "Could not search mentions. Try again.",
  editor_retry: () => "Try again",

  calendar_next: () => "Next month",
  calendar_previous: () => "Previous month",
  calendar_label: () => "Calendar",
  color_picker_pick_from_screen: () => "Pick a color from the screen",
  color_picker_brand_colors: () => "Brand colors",
  color_picker_recent_colors: () => "Recent colors",
  color_picker_hex_color: () => "Hex color",
  color_picker_hue: () => "Hue",
  color_picker_saturation: () => "Saturation",
  color_picker_lightness: () => "Lightness",
  color_picker_opacity: () => "Opacity",
  common_close: () => "Close",
  common_toggle_sidebar: () => "Toggle sidebar",
  common_mobile_sidebar_description: () => "Displays the mobile sidebar.",
  common_sidebar: () => "Sidebar",
  chart_keyboard_help: () =>
    "Use the arrow keys to move through the data, Home and End to jump to the ends, Escape to clear.",
  chart_category: () => "Category",
  chart_series: () => "Series",
  chart_spotlight: (label) => `Spotlight ${label}`,
  chart_slices: () => "Slices",
  chart_value: () => "Value",
  chart_share: () => "Share",
  chart_slice_keyboard_help: () =>
    "Use the arrow keys to move between slices, Enter to keep one lit, Escape to clear.",
  chart_axis: () => "Axis",
  chart_axis_keyboard_help: () => "Use the arrow keys to move between axes, Escape to clear.",
  chart_less: () => "Less",
  chart_more: () => "More",
  chart_none: () => "None",
  chart_levels: () => "Levels",
  chart_up_to: (value) => `Up to ${value}`,
  chart_more_than: (value) => `More than ${value}`,
  chart_square_keyboard_help: () =>
    "Use the arrow keys to move between squares, Home and End to jump to the first and last, Escape to clear.",
};
export function provideUiMessages(messages: Partial<UiMessages>) {
  setContext(messagesKey, { ...english, ...messages });
}
export function getUiMessages(): UiMessages {
  return getContext<UiMessages>(messagesKey) ?? english;
}
