import { expect, test } from "bun:test";
import { referencedMessageKeys } from "./i18n-source-usage.mjs";

test("finds static Paraglide calls without treating ordinary m properties as messages", () => {
  expect(
    referencedMessageKeys(`
      import { locale, m } from '$lib/paraglide/messages';
      const item = media.find((m) => m.id === id);
      const title = m.quick_cut_reconnect();
      const body = m.quick_cut_source_label ({ index: 2 });
      const duplicate = m.quick_cut_reconnect();
    `),
  ).toEqual(["quick_cut_reconnect", "quick_cut_source_label"]);

  expect(referencedMessageKeys("const item = rows.find((m) => m.id === id);")).toEqual([]);
});
