### Fixed

- Removing a weekly posting time now deletes all its weekdays in one transaction. Reloading during removal can no longer leave a partially deleted row. Retries safely accept already removed slots and preserve other times and workspaces.
