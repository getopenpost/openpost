### Fixed

- Cancel layer renaming with Escape without saving the discarded name. Keep focus on the next control when a layer or page rename saves on blur.
- Keep layer names readable on phones and touch screens by placing reorder controls in the Layers header.
- Move layers past sibling groups in one step, without counting their children as neighboring layers.
- Preserve stacking when grouping or ungrouping layers, including selections across groups. Keep children inside their surviving ancestor when ungrouping nested selections.

### Improved

- Recalculate nested group bounds in one children-first pass instead of repeatedly scanning every layer.
