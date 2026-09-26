### Fixed

- Fixed workspace creation silently keeping the old workspace when a background refresh (such as the layout onboarding check) resolves after the new selection is applied. Implicit refreshes no longer move a selection that is newer than their own intent; they refresh the workspace inventory and keep the current workspace.
