# Workspace delete navigates home after remount

## Fixed

- Deleting the active workspace from workspace settings now navigates back to
  the home page as intended. Previously the deletion succeeded and the store
  switched to another workspace, but the page stayed on the settings URL of the
  deleted workspace: shrinking the workspace list flips the layout's workspace
  access key, which remounts the settings page through its onboarding loading
  gate mid-flight and invalidates the delete handler's still-current guard, so
  the post-delete navigation never ran. The handler now also navigates when the
  (possibly remounted) page still shows the deleted workspace.
