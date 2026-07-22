-- Phase 1: goals (budget-per-category caps, or savings targets).
--
-- type = 'budget': caps spending on a category over a period (category_id required).
-- type = 'savings': a savings target, optionally tied to an account that
-- accumulates towards it (e.g. a dedicated savings account).

create type public.goal_type as enum ('budget', 'savings');
create type public.goal_period as enum ('monthly', 'yearly', 'custom');

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  type public.goal_type not null,
  category_id uuid references public.categories(id),
  account_id uuid references public.accounts(id),
  target_amount numeric(14, 2) not null,
  period public.goal_period not null,
  start_date date not null,
  end_date date,
  description text,
  created_at timestamptz not null default now(),
  constraint goals_budget_requires_category check (
    type <> 'budget' or category_id is not null
  ),
  constraint goals_savings_no_category check (
    type <> 'savings' or category_id is null
  ),
  constraint goals_custom_requires_end_date check (
    period <> 'custom' or end_date is not null
  ),
  constraint goals_end_date_after_start check (
    end_date is null or end_date >= start_date
  )
);

create index goals_tenant_id_idx on public.goals(tenant_id);

alter table public.goals enable row level security;

create policy "goals_select_members" on public.goals
  for select using (public.is_tenant_member(tenant_id));

create policy "goals_insert_members" on public.goals
  for insert with check (public.is_tenant_member(tenant_id));

create policy "goals_update_members" on public.goals
  for update using (public.is_tenant_member(tenant_id));

create policy "goals_delete_members" on public.goals
  for delete using (public.is_tenant_member(tenant_id));
