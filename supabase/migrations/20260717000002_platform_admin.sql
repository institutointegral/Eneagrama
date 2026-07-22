-- Phase 3: superadmin layer, above the normal per-tenant RLS isolation.
--
-- platform_admins is intentionally separate from tenant_users: a platform
-- admin is not a member of any particular tenant, they oversee all of them.
-- There is no public self-promotion path — the first row is inserted
-- manually via SQL after this migration runs (see README "Promovendo o
-- primeiro superadmin").

alter table public.tenants add column is_active boolean not null default true;

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
-- No policies: this table is never queried directly from the client (no
-- "manage admins" screen in this phase), only through is_platform_admin()
-- and the admin_* functions below, all SECURITY DEFINER.

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

-- Additional permissive SELECT policies for platform admins on every
-- tenant-scoped table. Postgres OR's multiple permissive policies for the
-- same command together, so this only ever *adds* visibility for admins —
-- it cannot narrow what a regular tenant member already sees via the
-- existing is_tenant_member() policies.
create policy "tenants_select_platform_admin" on public.tenants
  for select using (public.is_platform_admin());

create policy "tenants_update_platform_admin" on public.tenants
  for update using (public.is_platform_admin());

create policy "tenant_users_select_platform_admin" on public.tenant_users
  for select using (public.is_platform_admin());

create policy "accounts_select_platform_admin" on public.accounts
  for select using (public.is_platform_admin());

create policy "categories_select_platform_admin" on public.categories
  for select using (public.is_platform_admin());

create policy "recurrences_select_platform_admin" on public.recurrences
  for select using (public.is_platform_admin());

create policy "transactions_select_platform_admin" on public.transactions
  for select using (public.is_platform_admin());

create policy "goals_select_platform_admin" on public.goals
  for select using (public.is_platform_admin());

create policy "whatsapp_links_select_platform_admin" on public.tenant_whatsapp_links
  for select using (public.is_platform_admin());

-- Admin-facing RPCs. Each still checks is_platform_admin() itself (defense
-- in depth — these run as SECURITY DEFINER, so they don't rely solely on
-- the RLS policies above to stay safe).

create or replace function public.admin_list_tenants()
returns table (
  tenant_id uuid,
  name text,
  is_active boolean,
  created_at timestamptz,
  member_count bigint,
  account_count bigint,
  transaction_count bigint,
  whatsapp_status public.whatsapp_link_status,
  whatsapp_phone_number text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized';
  end if;

  return query
    select
      t.id,
      t.name,
      t.is_active,
      t.created_at,
      (select count(*) from public.tenant_users tu where tu.tenant_id = t.id),
      (select count(*) from public.accounts a where a.tenant_id = t.id),
      (select count(*) from public.transactions tx where tx.tenant_id = t.id),
      (select w.status from public.tenant_whatsapp_links w
        where w.tenant_id = t.id and w.status = 'active' limit 1),
      (select w.phone_number from public.tenant_whatsapp_links w
        where w.tenant_id = t.id and w.status = 'active' limit 1)
    from public.tenants t
    order by t.created_at desc;
end;
$$;

create or replace function public.admin_tenant_users(p_tenant_id uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized';
  end if;

  return query
    select tu.user_id, u.email::text, tu.role, tu.created_at
    from public.tenant_users tu
    join auth.users u on u.id = tu.user_id
    where tu.tenant_id = p_tenant_id;
end;
$$;

create or replace function public.admin_set_tenant_active(p_tenant_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized';
  end if;

  update public.tenants set is_active = p_is_active where id = p_tenant_id;
end;
$$;
