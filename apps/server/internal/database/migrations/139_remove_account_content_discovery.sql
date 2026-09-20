-- OpenPost only tracks content published through OpenPost. Account content
-- discovery (native provider history, external inventory, observations, and
-- discovery checkpoints) is removed; drop its tables.

DROP TABLE IF EXISTS account_content_observations;
DROP TABLE IF EXISTS analytics_account_content_snapshots;
DROP TABLE IF EXISTS account_content_discovery_leases;
DROP TABLE IF EXISTS account_content_discovery_states;
DROP TABLE IF EXISTS account_contents;
