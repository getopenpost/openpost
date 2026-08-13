-- 066: Persist each user's preferred composer experience.
--
-- The conditional column addition lives in prepareMigration because fresh
-- schemas already include the field through the Bun model.
SELECT 1;
