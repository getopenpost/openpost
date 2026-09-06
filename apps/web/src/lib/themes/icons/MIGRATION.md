# Theme icon migration map (phase 1 deliverable)

Every direct `@lucide/svelte` icon use under `apps/web/src` mapped by MEANING to a registry role.
`theme` = `<ThemeIcon role="...">` (pack-rendered). `protected` = `<ProtectedIcon icon="...">` (stable glyph).
New roles added in phase 1: 12 theme roles, 44 protected roles. All five packs regenerated via `bun scripts/generate-theme-icon-packs.mjs`.
Excluded (documented public exceptions, keep direct imports): `routes/_components/PublicHome.svelte`, `routes/u/[username]/+page.svelte`.
Excluded (test files, owned by test workers): any `*.test.*` under `apps/web/src` (e.g. `ui-consistency.svelte.test.ts` uses the image icon).

## Non-component usage

`lib/notification-topics.ts` stores icon _component references_ in a topic map (bell, mail, reply, circle-alert).
Phase 2 must change the map to store `{ kind, role }` pairs and render `ThemeIcon`/`ProtectedIcon` at the usage site.

## Per-site overrides (default mapping does NOT apply)

| File                                                                                                               | Icon               | Use instead                     | Why                                               |
| ------------------------------------------------------------------------------------------------------------------ | ------------------ | ------------------------------- | ------------------------------------------------- |
| lib/image-editor/components/layer-tree.svelte                                                                      | pencil             | protected `editor-paint`        | raster paint-layer type glyph, not an edit action |
| lib/video-editor/components/timeline-voiceover-control.svelte                                                      | mic                | protected `editor-record`       | record button, not generic audio                  |
| lib/video-editor/components/source-monitor.svelte                                                                  | repeat-2           | protected `editor-loop`         | loop-playback toggle, not repost                  |
| lib/components/instance-ai-prompts.svelte, lib/components/instance-configuration.svelte, routes/media/+page.svelte | rotate-ccw         | theme `refresh`                 | reset-to-default, not canvas rotate               |
| lib/image-editor/components/asset-panel.svelte, lib/image-editor/components/image-editor-shell.svelte              | circle, square     | protected `editor-shapes`       | vector shape tools                                |
| lib/video-editor/components/timeline-voiceover-control.svelte, lib/video-editor/components/transport-bar.svelte    | square             | protected `editor-stop`         | stop button                                       |
| routes/register/+page.svelte                                                                                       | circle             | protected `pending`             | pending password-rule status                      |
| lib/video-editor/components/agent-chat-panel.svelte                                                                | circle-dashed      | protected `pending`             | skipped/pending step status                       |
| lib/video-editor/components/color-workspace.svelte                                                                 | circle-off         | protected `editor-compare`      | show-ungraded-before toggle                       |
| lib/video-editor/components/editor-workspace-switcher.svelte                                                       | scissors           | protected `editor-cut` (verify) | confirm meaning before migrating                  |
| lib/image-editor/components/properties-panel.svelte                                                                | link               | theme `link` (verify)           | confirm layer-link vs arrange meaning             |
| routes/media/+page.svelte                                                                                          | sliders-horizontal | theme `controls` (verify)       | confirm sort/filter vs tune meaning               |
| routes/editors/+page.svelte                                                                                        | clapperboard, film | theme `editors` (verify)        | confirm section meaning                           |

## Full icon map

| Lucide icon                        | Registry  | Role                             | Files |
| ---------------------------------- | --------- | -------------------------------- | ----: |
| activity                           | theme     | `analytics`                      |     3 |
| align-center-horizontal            | protected | `editor-align-center-horizontal` |     1 |
| align-center-vertical              | protected | `editor-align-center-vertical`   |     1 |
| align-end-horizontal               | protected | `editor-align-bottom`            |     1 |
| align-end-vertical                 | protected | `editor-align-right`             |     1 |
| align-horizontal-distribute-center | protected | `editor-distribute-horizontal`   |     1 |
| align-start-horizontal             | protected | `editor-align-top`               |     1 |
| align-start-vertical               | protected | `editor-align-left`              |     1 |
| align-vertical-distribute-center   | protected | `editor-distribute-vertical`     |     1 |
| archive                            | theme     | `archive`                        |     2 |
| arrow-down                         | theme     | `arrow-down`                     |     1 |
| arrow-left                         | theme     | `arrow-left`                     |     3 |
| arrow-left-right                   | theme     | `swap`                           |     3 |
| arrow-right                        | theme     | `arrow-right`                    |     2 |
| arrow-up                           | theme     | `arrow-up`                       |     1 |
| bell                               | theme     | `notification`                   |     2 |
| bell-off                           | theme     | `notification`                   |     1 |
| bell-ring                          | theme     | `notification`                   |     1 |
| blend                              | protected | `editor-blend`                   |     2 |
| bold                               | protected | `editor-text`                    |     1 |
| bot                                | theme     | `assistant`                      |     1 |
| braces                             | theme     | `code`                           |     1 |
| bring-to-front                     | protected | `editor-arrange-front`           |     2 |
| building-2                         | theme     | `organization`                   |     3 |
| calendar                           | theme     | `calendar`                       |     1 |
| calendar-days                      | theme     | `calendar`                       |     3 |
| camera                             | theme     | `camera`                         |     3 |
| chart-no-axes-column-increasing    | theme     | `analytics`                      |     1 |
| chart-no-axes-combined             | theme     | `analytics`                      |     1 |
| check                              | theme     | `check`                          |     8 |
| check-check                        | theme     | `check`                          |     1 |
| check-circle-2                     | protected | `success`                        |     4 |
| chevron-down                       | theme     | `chevron-down`                   |     4 |
| chevron-left                       | theme     | `chevron-left`                   |     4 |
| chevron-right                      | theme     | `chevron-right`                  |     4 |
| circle                             | protected | `pending`                        |     3 |
| circle-alert                       | protected | `error`                          |     2 |
| circle-check                       | protected | `success`                        |     3 |
| circle-dashed                      | protected | `pending`                        |     2 |
| circle-off                         | protected | `editor-compare`                 |     1 |
| circle-x                           | protected | `error`                          |     2 |
| clapperboard                       | protected | `editor-animation`               |     1 |
| clipboard                          | theme     | `copy`                           |     1 |
| clipboard-paste                    | theme     | `copy`                           |     2 |
| clock                              | theme     | `time`                           |     3 |
| clock-3                            | theme     | `time`                           |     1 |
| columns-2                          | theme     | `layout`                         |     1 |
| combine                            | protected | `editor-combine`                 |     1 |
| copy                               | theme     | `copy`                           |     8 |
| credit-card                        | theme     | `billing`                        |     2 |
| crop                               | protected | `editor-crop`                    |     3 |
| crosshair                          | protected | `editor-focus`                   |     1 |
| diamond                            | protected | `editor-keyframe`                |     6 |
| diamond-minus                      | protected | `editor-keyframe`                |     1 |
| download                           | theme     | `download`                       |     4 |
| ellipsis                           | theme     | `more-horizontal`                |     4 |
| eraser                             | protected | `editor-erase`                   |     1 |
| external-link                      | theme     | `external-link`                  |     8 |
| eye                                | theme     | `eye`                            |     2 |
| eye-off                            | theme     | `eye-off`                        |     1 |
| file-audio                         | protected | `media-audio`                    |     2 |
| file-text                          | theme     | `file`                           |     2 |
| files                              | theme     | `publications`                   |     1 |
| filter                             | theme     | `filter`                         |     1 |
| flag                               | protected | `editor-marker`                  |     3 |
| flip-horizontal-2                  | protected | `editor-flip-horizontal`         |     2 |
| flip-vertical-2                    | protected | `editor-flip-vertical`           |     2 |
| focus                              | protected | `editor-focus`                   |     1 |
| folder                             | theme     | `folder`                         |     1 |
| folder-open                        | theme     | `folder`                         |     1 |
| folder-plus                        | theme     | `folder`                         |     1 |
| gauge                              | protected | `editor-speed`                   |     4 |
| grid-2x2                           | theme     | `layout`                         |     1 |
| grip-vertical                      | theme     | `drag`                           |     1 |
| group                              | protected | `editor-group`                   |     3 |
| hand                               | protected | `editor-pan`                     |     1 |
| hard-drive                         | theme     | `storage`                        |     1 |
| hash                               | theme     | `tag`                            |     1 |
| headphones                         | theme     | `audio`                          |     1 |
| heart                              | theme     | `favorite`                       |     4 |
| history                            | theme     | `history`                        |     3 |
| image                              | theme     | `image`                          |    10 |
| image-plus                         | theme     | `image-add`                      |     1 |
| inbox                              | theme     | `inbox`                          |     2 |
| italic                             | protected | `editor-text`                    |     1 |
| key-round                          | theme     | `key`                            |     5 |
| keyboard                           | theme     | `controls`                       |     1 |
| lasso-select                       | protected | `editor-lasso`                   |     1 |
| laugh                              | protected | `editor-emoji`                   |     1 |
| layers                             | protected | `editor-layers`                  |     1 |
| layers-3                           | protected | `editor-layers`                  |     5 |
| layout-grid                        | theme     | `layout`                         |     2 |
| library                            | theme     | `media`                          |     1 |
| lightbulb                          | theme     | `idea`                           |     1 |
| link                               | theme     | `link`                           |     1 |
| link-2                             | theme     | `link`                           |     1 |
| list                               | theme     | `layout`                         |     5 |
| list-video                         | theme     | `video`                          |     1 |
| loader-2                           | protected | `loading`                        |    41 |
| loader-circle                      | protected | `loading`                        |     3 |
| lock                               | theme     | `lock`                           |     2 |
| lock-keyhole                       | theme     | `lock`                           |     2 |
| lock-open                          | theme     | `lock`                           |     2 |
| log-out                            | theme     | `logout`                         |     1 |
| magnet                             | protected | `editor-snap`                    |     2 |
| mail                               | theme     | `mail`                           |     1 |
| mail-check                         | theme     | `mail`                           |     1 |
| maximize                           | theme     | `layout`                         |     1 |
| maximize-2                         | theme     | `layout`                         |     1 |
| message-circle                     | theme     | `feedback`                       |     1 |
| messages-square                    | theme     | `communications`                 |     1 |
| mic                                | theme     | `audio`                          |     1 |
| minimize                           | theme     | `layout`                         |     1 |
| minus                              | theme     | `remove`                         |     3 |
| monitor                            | theme     | `devices`                        |     1 |
| mouse-pointer-2                    | protected | `editor-select`                  |     1 |
| move                               | protected | `editor-move`                    |     1 |
| music                              | theme     | `audio`                          |     3 |
| paint-bucket                       | protected | `editor-fill`                    |     1 |
| palette                            | theme     | `appearance`                     |     9 |
| panel-left                         | theme     | `layout`                         |     1 |
| pencil                             | theme     | `edit`                           |     9 |
| pipette                            | protected | `editor-eyedropper`              |     3 |
| plug                               | theme     | `plugin`                         |     1 |
| plus                               | theme     | `add`                            |    13 |
| radio                              | protected | `editor-solo`                    |     1 |
| refresh-cw                         | theme     | `refresh`                        |    10 |
| repeat-2                           | theme     | `repeat`                         |     3 |
| reply                              | theme     | `reply`                          |     2 |
| rocket                             | theme     | `launch`                         |     1 |
| rotate-ccw                         | protected | `editor-rotate-left`             |     5 |
| rotate-cw                          | protected | `editor-rotate-right`            |     1 |
| rows-3                             | theme     | `layout`                         |     2 |
| save                               | theme     | `save`                           |     1 |
| scan-line                          | protected | `editor-upscale`                 |     1 |
| scissors                           | protected | `editor-cut`                     |     3 |
| search                             | theme     | `search`                         |     5 |
| send                               | theme     | `send`                           |     2 |
| send-to-back                       | protected | `editor-arrange-back`            |     2 |
| server-cog                         | theme     | `settings`                       |     1 |
| settings                           | theme     | `settings`                       |     1 |
| settings-2                         | theme     | `settings`                       |     2 |
| shield                             | theme     | `security`                       |     1 |
| shield-check                       | theme     | `security`                       |     5 |
| shuffle                            | protected | `editor-shuffle`                 |     1 |
| skip-back                          | protected | `editor-skip-back`               |     2 |
| skip-forward                       | protected | `editor-skip-forward`            |     1 |
| sliders-horizontal                 | theme     | `controls`                       |     3 |
| smartphone                         | theme     | `devices`                        |     2 |
| sparkles                           | theme     | `sparkles`                       |     1 |
| square                             | protected | `editor-stop`                    |     5 |
| square-dashed                      | protected | `editor-paint`                   |     1 |
| square-dashed-mouse-pointer        | protected | `editor-marquee`                 |     1 |
| tag                                | theme     | `tag`                            |     1 |
| terminal                           | theme     | `code`                           |     2 |
| trash                              | theme     | `delete`                         |     7 |
| trash-2                            | theme     | `delete`                         |    11 |
| triangle-alert                     | protected | `warning`                        |     1 |
| type                               | protected | `editor-text`                    |     5 |
| underline                          | protected | `editor-text`                    |     1 |
| undo-2                             | theme     | `undo`                           |     1 |
| ungroup                            | protected | `editor-ungroup`                 |     4 |
| unlink                             | theme     | `unlink`                         |     3 |
| unlock                             | theme     | `lock`                           |     2 |
| unplug                             | theme     | `plugin`                         |     1 |
| upload                             | theme     | `upload`                         |     2 |
| user-plus                          | theme     | `growth`                         |     2 |
| user-round                         | theme     | `user`                           |     1 |
| user-round-cog                     | theme     | `user`                           |     1 |
| user-round-plus                    | theme     | `growth`                         |     1 |
| user-round-x                       | theme     | `user`                           |     1 |
| users                              | theme     | `users`                          |     4 |
| users-round                        | theme     | `users`                          |     1 |
| video                              | theme     | `video`                          |     3 |
| volume-1                           | theme     | `audio`                          |     1 |
| volume-2                           | theme     | `audio`                          |     4 |
| volume-x                           | theme     | `audio`                          |     3 |
| wallpaper                          | protected | `editor-backgrounds`             |     1 |
| wand-sparkles                      | protected | `editor-effects`                 |     1 |
| x                                  | theme     | `close`                          |     5 |
| zoom-in                            | theme     | `layout`                         |     3 |
| zoom-out                           | theme     | `layout`                         |     2 |
