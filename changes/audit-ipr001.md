### Fixed

- Floating pixel-selection resize handles now keep the opposite corner fixed and follow the pointer. The viewport no longer starts a second selection-move gesture when a canvas control receives the drag. (IPR001)
- Paint pixels now follow the resized selection bounds instead of retaining their original render size, and solid fills stay seamless during fractional resizing.
