-- Phase 1: multi-tenancy foundation (tenants, tenant_users) + RLS helper functions.
--
-- Every tenant-scoped table follows the same pattern: a `tenant_id` column plus RLS
-- policies that call `is_tenant_member(tenant_id)` / `is_tenant_owner(tenant_id)`.
-- Those helpers are SECURITY DEFINER functions owned by the migration role, which in
-- Postgres makes table owners exempt from RLS on the tables *they* query internally.
-- That lets tenant_users' own RLS policy call is_tenant_member() (which queries
-- tenant_users) without recursively re-applying tenant_users' RLS to itself.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.tenant_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index tenant_users_user_id_idx on public.tenant_users(user_id);
create index tenant_users_tenant_id_idx on public.tenant_users(tenant_id);

-- Returns true if the currently authenticated user belongs to the given tenant.
create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = auth.uid()
  );
$$;

-- Returns true if the currently authenticated user is an owner of the given tenant.
create or replace function public.is_tenant_owner(p_tenant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = auth.uid()
      and tu.role = 'owner'
  );
$$;

-- Creates a new tenant and makes the calling user its owner in a single atomic call.
-- This is the only supported way to create a tenant from the client, since tenants
-- and their first tenant_users row must be created together.
create or replace function public.create_tenant(p_name text)
returns public.tenants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated to create a tenant';
  end if;

  insert into public.tenants (name) values (p_name) returning * into v_tenant;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant.id, auth.uid(), 'owner');

  return v_tenant;
end;
$$;

alter table public.tenants enable row level security;
alter table public.tenant_users enable row level security;

create policy "tenants_select_members" on public.tenants
  for select using (public.is_tenant_member(id));

create policy "tenants_update_owners" on public.tenants
  for update using (public.is_tenant_owner(id));

-- Direct inserts/deletes on tenants are not exposed; use create_tenant() (insert)
-- and cascading delete via tenant_users management for removal.

create policy "tenant_users_select_own_tenant" on public.tenant_users
  for select using (public.is_tenant_member(tenant_id));

create policy "tenant_users_insert_owners" on public.tenant_users
  for insert with check (public.is_tenant_owner(tenant_id));

create policy "tenant_users_update_owners" on public.tenant_users
  for update using (public.is_tenant_owner(tenant_id));

create policy "tenant_users_delete_owners" on public.tenant_users
  for delete using (public.is_tenant_owner(tenant_id));
