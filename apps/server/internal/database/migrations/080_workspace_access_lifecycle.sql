-- The cross-dialect workspace access upgrade is prepared and repaired by
-- ensureWorkspaceAccessLifecycleSchema. Keeping the recorded migration body
-- side-effect free lets isolated historical-schema fixtures run the complete
-- migration chain without inventing absent workspace tables.
SELECT 1;
