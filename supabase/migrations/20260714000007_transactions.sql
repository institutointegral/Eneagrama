-- Phase 1: transactions (the core ledger of realized and projected entries).
--
-- status: 'realized' (actually happened) vs 'projected' (expected: future
-- installment, future recurrence occurrence). Cash-flow reports can sum either
-- bucket independently or combined.
--
-- Settling a projected transaction NEVER duplicates it: a new 'realized' row is
-- inserted with linked_transaction_id pointing back at the original projected row,
-- and the original projected row gets settled_by pointing at the new realized row.
-- This keeps the original projection intact (useful for audit/history of a
-- recurrence or installment plan) while cash-flow sums stay correct: querying
-- status = 'realized' picks up settled rows exactly once, and querying
-- status = 'projected' and settled_by is null gives the still-pending projections.
-- See settle_transaction() in a later migration for the supported way to do this.

create type public.transaction_status as enum ('realized', 'projected');
create type public.transaction_form as enum ('cash', 'installment');

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  category_id uuid references public.categories(id),
  description text not null,
  amount numeric(14, 2) not null,
  type public.category_type not null,
  date date not null,
  status public.transaction_status not null default 'realized',
  form public.transaction_form not null default 'cash',
  installment_group_id uuid,
  installment_number smallint,
  installment_total smallint,
  linked_transaction_id uuid references public.transactions(id),
  settled_by uuid references public.transactions(id),
  recurrence_id uuid references public.recurrences(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_installment_fields_check check (
    (form = 'installment'
      and installment_group_id is not null
      and installment_number is not null
      and installment_total is not null
      and installment_number between 1 and installment_total)
    or
    (form = 'cash'
      and installment_group_id is null
      and installment_number is null
      and installment_total is null)
  ),
  constraint transactions_no_self_reference check (
    id <> linked_transaction_id and id <> settled_by
  )
);

create index transactions_tenant_id_idx on public.transactions(tenant_id);
create index transactions_account_id_idx on public.transactions(account_id);
create index transactions_category_id_idx on public.transactions(category_id);
create index transactions_date_idx on public.transactions(date);
create index transactions_status_idx on public.transactions(status);
create index transactions_installment_group_id_idx on public.transactions(installment_group_id);
create index transactions_recurrence_id_idx on public.transactions(recurrence_id);

alter table public.transactions enable row level security;

create policy "transactions_select_members" on public.transactions
  for select using (public.is_tenant_member(tenant_id));

create policy "transactions_insert_members" on public.transactions
  for insert with check (public.is_tenant_member(tenant_id));

create policy "transactions_update_members" on public.transactions
  for update using (public.is_tenant_member(tenant_id));

create policy "transactions_delete_members" on public.transactions
  for delete using (public.is_tenant_member(tenant_id));
