-- 180: Remove the synthetic "All channels" Social Set added by the 3.0 upgrade.
--
-- It duplicated Select all and froze its membership at upgrade time. The
-- conditional cleanup lives in prepareMigration so it can skip edited sets.
SELECT 1;
