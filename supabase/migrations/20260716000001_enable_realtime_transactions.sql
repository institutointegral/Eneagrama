-- Enables Supabase Realtime (postgres_changes) for transactions, used by the
-- Lançamentos and Dashboard screens to reflect changes without a manual
-- reload. RLS on transactions already restricts visibility to tenant
-- members (is_tenant_member), and Realtime enforces that same RLS per
-- subscriber, so this does not widen access — it only adds change
-- broadcasting for rows a client could already read.
alter publication supabase_realtime add table public.transactions;
