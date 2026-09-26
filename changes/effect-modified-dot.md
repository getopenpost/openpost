### Fixed

- The Video Editor effects panel "Modified from defaults" indicator now exposes its label through `role="img"`. The label was previously set on a role-less wrapper around an aria-hidden dot, so assistive technology silently ignored it and a tweaked effect was announced without its modified state.
