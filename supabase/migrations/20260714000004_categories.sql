-- Phase 1: categories (system defaults + tenant-custom), with subcategory support
-- via self-referencing parent_category_id.
--
-- tenant_id is nullable: null means a system default category, visible to every
-- tenant read-only. A non-null tenant_id is a tenant's own custom category.

create type public.category_type as enum ('income', 'expense');

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  name text not null,
  type public.category_type not null,
  icon text,
  color text,
  parent_category_id uuid references public.categories(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index categories_tenant_id_idx on public.categories(tenant_id);
create index categories_parent_category_id_idx on public.categories(parent_category_id);

alter table public.categories enable row level security;

-- Everyone can read system categories (tenant_id is null); tenant members can
-- additionally read their own tenant's custom categories.
create policy "categories_select_system_or_own_tenant" on public.categories
  for select using (
    tenant_id is null or public.is_tenant_member(tenant_id)
  );

-- Only custom (non-system) categories can be created/modified by tenants, and only
-- for their own tenant.
create policy "categories_insert_own_tenant" on public.categories
  for insert with check (
    tenant_id is not null and public.is_tenant_member(tenant_id)
  );

create policy "categories_update_own_tenant" on public.categories
  for update using (
    tenant_id is not null and public.is_tenant_member(tenant_id)
  );

create policy "categories_delete_own_tenant" on public.categories
  for delete using (
    tenant_id is not null and public.is_tenant_member(tenant_id)
  );
