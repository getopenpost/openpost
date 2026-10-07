# OpenPost UI

Shared Svelte 5 controls, theme manifests, local icons and styles for OpenPost and standalone tools. The package has no SvelteKit, API, auth, telemetry or generated-translation dependency.

```svelte
<script lang="ts">
  import { Button, Input, Textarea } from '@openpost/ui';
</script>
<Button intent="focal">Generate</Button>
```

Import `@openpost/ui/style.css` after Tailwind CSS 4. The stylesheet registers the packaged components as Tailwind sources. Consumers choose and bundle fonts; the default uses Geist, Geist Mono and Manrope. Import `@openpost/ui/tokens.css` alone for React or other CSS consumers that need the palette without Svelte controls.

Use the `components/<name>` exports for compound controls, such as `@openpost/ui/components/dialog`. Shared controls accept standard Svelte snippets and native event props. `NativeSelect` and `CheckboxInput` keep browser-native semantics with shared theme recipes; use them where native form behavior is needed.

## Themes

Import a single family from `themes/builtins/<name>` and resolve it with `resolveLocalTheme` from `themes/resolve`. Apply it with `WebThemeRuntime` from `themes/runtime`. The full catalogue remains available from `themes/builtins`. Runtime validation, resource staging, protected editor surfaces, reduced motion and local theme icons follow the same contracts as the app.

UI labels default to English. Svelte consumers call `provideUiMessages` from `messages` during root initialization to adapt labels to their localization system. Context keeps labels local to each component tree; no app-generated modules or global locale state belong in this package.

## Build and consume

Run `devenv shell -- bunx turbo run check --filter @openpost/ui` from the repository root. Package builds depend on `@openpost/dither` and emit JavaScript, Svelte components and declarations into `dist`. The build lock protects shared output when root checks launch multiple Turbo processes.

OpenPost uses workspace dependencies. Separate repositories may install versioned registry releases or `npm pack` archives of both `packages/ui` and `packages/dither`. Archives contain the compiled library and licenses, with no sibling-checkout paths. Rebuild, repack and update the consumer lockfile together when the library changes.

React Native cannot render Svelte or CSS. Its existing native theme renderer consumes generated theme contracts and icon data. Keep that platform adapter; do not copy web component implementations into native components.

Licensed under AGPL-3.0-only, matching OpenPost. Third-party dependencies retain their own licenses.
