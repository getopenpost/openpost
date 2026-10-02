### Fixed

- Motion layers protected by a track or group lock can no longer acquire or remove a transform parent. Unlocked children remain editable when only their controller is locked (MOTL001).
- Locked layer and controller transform fields, resets, flips, aspect ratio and blend controls now show their disabled state instead of accepting input that cannot be saved. Inspector disclosures remain available (MLC001).
