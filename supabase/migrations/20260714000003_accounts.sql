-- Phase 1: accounts (checking, savings, wallet, credit card, investment).
--
-- Credit cards are a separate account: expenses posted to a credit_card account do
-- not touch any other account's balance. The card's invoice is only settled when a
-- payment transaction against the paying account is created (application logic in
-- later phases); this migration only stores the card's billing metadata.

create type public.account_type as enum ('checking', 'savings', 'wallet', 'credit_card', 'investment');

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  type public.account_type not null,
  initial_balance numeric(14, 2) not null default 0,
  is_active boolean not null default true,
  -- Credit-card-only billing fields.
  closing_day smallint check (closing_day between 1 and 31),
  due_day smallint check (due_day between 1 and 31),
  credit_limit numeric(14, 2),
  created_at timestamptz not null default now(),
  constraint accounts_credit_card_fields_check check (
    type = 'credit_card'
    or (closing_day is null and due_day is null and credit_limit is null)
  )
);

create index accounts_tenant_id_idx on public.accounts(tenant_id);

alter table public.accounts enable row level security;

create policy "accounts_select_members" on public.accounts
  for select using (public.is_tenant_member(tenant_id));

create policy "accounts_insert_members" on public.accounts
  for insert with check (public.is_tenant_member(tenant_id));

create policy "accounts_update_members" on public.accounts
  for update using (public.is_tenant_member(tenant_id));

create policy "accounts_delete_members" on public.accounts
  for delete using (public.is_tenant_member(tenant_id));
