-- Откат 0000_extensions_roles. Роли — общие для кластера: удаляются, только если больше нигде не используются.
DROP EXTENSION IF EXISTS citext;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_user', 'migrator', 'analytics_ro'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      BEGIN
        EXECUTE format('DROP ROLE %I', r);
      EXCEPTION WHEN dependent_objects_still_exist THEN
        RAISE NOTICE 'role % is still used by another database, kept', r;
      END;
    END IF;
  END LOOP;
END
$$;
