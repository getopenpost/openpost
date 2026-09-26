### Fixed

- The Video Editor on-canvas position motion path now exposes its "Position motion path" label through `role="group"`. The label was previously set on the wrapping `<svg>` without a role, so assistive technology silently ignored it and the motion keyframe controls were announced without their path context.
