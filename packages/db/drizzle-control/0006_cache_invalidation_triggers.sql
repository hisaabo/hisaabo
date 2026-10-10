CREATE OR REPLACE FUNCTION hisaabo_cache_notify() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  k jsonb := '{}'::jsonb;
  o jsonb := '{}'::jsonb;
  nj jsonb;
  oj jsonb;
  i int;
  col text;
  p jsonb;
BEGIN
  IF TG_OP <> 'DELETE' THEN nj := to_jsonb(NEW); END IF;
  IF TG_OP <> 'INSERT' THEN oj := to_jsonb(OLD); END IF;
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    col := TG_ARGV[i];
    k := k || jsonb_build_object(col, coalesce(nj -> col, oj -> col));
    IF nj IS NOT NULL AND oj IS NOT NULL AND (oj -> col) IS DISTINCT FROM (nj -> col) THEN
      o := o || jsonb_build_object(col, oj -> col);
    END IF;
  END LOOP;
  p := jsonb_build_object('t', TG_TABLE_NAME, 'op', TG_OP, 'k', k);
  IF o <> '{}'::jsonb THEN p := p || jsonb_build_object('o', o); END IF;
  PERFORM pg_notify('cache_invalidate', p::text);
  RETURN NULL;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS hisaabo_cache_tenant_members ON tenant_members;
--> statement-breakpoint
CREATE TRIGGER hisaabo_cache_tenant_members AFTER INSERT OR UPDATE OR DELETE ON tenant_members FOR EACH ROW EXECUTE FUNCTION hisaabo_cache_notify('tenant_id', 'user_id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS hisaabo_cache_tenants ON tenants;
--> statement-breakpoint
CREATE TRIGGER hisaabo_cache_tenants AFTER UPDATE OF status, plan OR DELETE ON tenants FOR EACH ROW EXECUTE FUNCTION hisaabo_cache_notify('id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS hisaabo_cache_sessions_del ON sessions;
--> statement-breakpoint
CREATE TRIGGER hisaabo_cache_sessions_del AFTER DELETE ON sessions FOR EACH ROW WHEN (OLD.expires_at > now()) EXECUTE FUNCTION hisaabo_cache_notify('user_id', 'tenant_id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS hisaabo_cache_sessions_upd ON sessions;
--> statement-breakpoint
CREATE TRIGGER hisaabo_cache_sessions_upd AFTER UPDATE ON sessions FOR EACH ROW WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.user_id <> NEW.user_id OR NEW.expires_at < OLD.expires_at) EXECUTE FUNCTION hisaabo_cache_notify('user_id', 'tenant_id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS hisaabo_cache_users ON users;
--> statement-breakpoint
CREATE TRIGGER hisaabo_cache_users AFTER UPDATE OF email, name OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION hisaabo_cache_notify('id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS hisaabo_cache_api_keys ON api_keys;
--> statement-breakpoint
CREATE TRIGGER hisaabo_cache_api_keys AFTER DELETE OR UPDATE OF key_hash, user_id, tenant_id, expires_at ON api_keys FOR EACH ROW EXECUTE FUNCTION hisaabo_cache_notify('id', 'user_id', 'tenant_id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS hisaabo_cache_system_config ON system_config;
--> statement-breakpoint
CREATE TRIGGER hisaabo_cache_system_config AFTER INSERT OR UPDATE OR DELETE ON system_config FOR EACH ROW EXECUTE FUNCTION hisaabo_cache_notify('key');
--> statement-breakpoint
DROP TRIGGER IF EXISTS hisaabo_cache_store_slugs ON store_slugs;
--> statement-breakpoint
CREATE TRIGGER hisaabo_cache_store_slugs AFTER INSERT OR UPDATE OR DELETE ON store_slugs FOR EACH ROW EXECUTE FUNCTION hisaabo_cache_notify('slug');
