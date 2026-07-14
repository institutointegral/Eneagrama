-- Phase 1: recurrences (recurring income/expense rules).
--
-- Each recurrence generates `projected` transactions automatically (see the
-- generate_recurrence_transactions() function and trigger in a later migration).
-- reference_day is the day of month (1-31) for monthly/yearly rules, or the ISO
-- day of week (0=Sunday..6=Saturday) for weekly rules. reference_month is only
-- used for yearly rules.

create type public.recurrence_interval as enum ('weekly', 'monthly', 'yearly');

create table public.recurrences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  category_id uuid references public.categories(id),
  description text not null,
  amount numeric(14, 2) not null,
  type public.category_type not null,
  interval public.recurrence_interval not null,
  reference_day smallint not null check (reference_day between 0 and 31),
  reference_month smallint check (reference_month between 1 and 12),
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint recurrences_yearly_requires_month check (
    interval <> 'yearly' or reference_month is not null
  ),
  constraint recurrences_end_date_after_start check (
    end_date is null or end_date >= start_date
  )
);

create index recurrences_tenant_id_idx on public.recurrences(tenant_id);

alter table public.recurrences enable row level security;

create policy "recurrences_select_members" on public.recurrences
  for select using (public.is_tenant_member(tenant_id));

create policy "recurrences_insert_members" on public.recurrences
  for insert with check (public.is_tenant_member(tenant_id));

create policy "recurrences_update_members" on public.recurrences
  for update using (public.is_tenant_member(tenant_id));

create policy "recurrences_delete_members" on public.recurrences
  for delete using (public.is_tenant_member(tenant_id));
