-- Phase 1: hardening based on Supabase security/performance advisors.
--
-- 1. Pin search_path on functions that were missing it (prevents search_path
--    hijacking via a malicious object shadowing an unqualified name).
-- 2. Real fix: generate_recurrence_transactions() is SECURITY DEFINER and, before
--    this migration, trusted its p_recurrence_id argument unconditionally. Since
--    SECURITY DEFINER bypasses RLS, any authenticated user could call this RPC
--    directly with another tenant's recurrence id and force-generate projected
--    transactions into that tenant. It now no-ops unless the caller is a member of
--    the recurrence's tenant. The trigger-driven flow (the only intended caller)
--    is unaffected, since a user can only insert/update recurrences in their own
--    tenant to begin with.
-- 3. extend_all_recurrences() is meant to run from a scheduled job (pg_cron/service
--    role), not from a client RPC call across every tenant at once. Revoke EXECUTE
--    from anon/authenticated; the function owner (used by pg_cron and the
--    dashboard SQL editor) is unaffected.
-- 4. Add covering indexes for foreign keys flagged by the performance advisor.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.next_recurrence_date(
  p_interval public.recurrence_interval,
  p_reference_day smallint,
  p_reference_month smallint,
  p_from_date date
)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  v_candidate date;
begin
  if p_interval = 'weekly' then
    return p_from_date + ((p_reference_day - extract(dow from p_from_date)::int + 7) % 7) * interval '1 day';
  elsif p_interval = 'monthly' then
    v_candidate := date_trunc('month', p_from_date)::date
      + (least(p_reference_day, extract(days from (date_trunc('month', p_from_date) + interval '1 month - 1 day'))::int) - 1) * interval '1 day';
    if v_candidate < p_from_date then
      v_candidate := date_trunc('month', p_from_date + interval '1 month')::date
        + (least(p_reference_day, extract(days from (date_trunc('month', p_from_date + interval '1 month') + interval '1 month - 1 day'))::int) - 1) * interval '1 day';
    end if;
    return v_candidate;
  else
    v_candidate := make_date(extract(year from p_from_date)::int, p_reference_month, 1)
      + (least(p_reference_day, extract(days from (make_date(extract(year from p_from_date)::int, p_reference_month, 1) + interval '1 month - 1 day'))::int) - 1) * interval '1 day';
    if v_candidate < p_from_date then
      v_candidate := make_date(extract(year from p_from_date)::int + 1, p_reference_month, 1)
        + (least(p_reference_day, extract(days from (make_date(extract(year from p_from_date)::int + 1, p_reference_month, 1) + interval '1 month - 1 day'))::int) - 1) * interval '1 day';
    end if;
    return v_candidate;
  end if;
end;
$$;

create or replace function public.generate_recurrence_transactions(p_recurrence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.recurrences%rowtype;
  v_horizon date := (current_date + interval '12 months')::date;
  v_last_date date;
  v_next_date date;
begin
  select * into r from public.recurrences where id = p_recurrence_id;

  if not found or not r.is_active then
    return;
  end if;

  if not public.is_tenant_member(r.tenant_id) then
    return;
  end if;

  if r.end_date is not null and r.end_date < v_horizon then
    v_horizon := r.end_date;
  end if;

  select max(date) into v_last_date
  from public.transactions
  where recurrence_id = p_recurrence_id;

  if v_last_date is null then
    v_next_date := public.next_recurrence_date(r.interval, r.reference_day, r.reference_month, r.start_date);
  else
    v_next_date := public.next_recurrence_date(r.interval, r.reference_day, r.reference_month, (v_last_date + interval '1 day')::date);
  end if;

  while v_next_date <= v_horizon loop
    insert into public.transactions (
      tenant_id, account_id, category_id, description, amount, type,
      date, status, form, recurrence_id
    ) values (
      r.tenant_id, r.account_id, r.category_id, r.description, r.amount, r.type,
      v_next_date, 'projected', 'cash', r.id
    );

    v_next_date := public.next_recurrence_date(r.interval, r.reference_day, r.reference_month, (v_next_date + interval '1 day')::date);
  end loop;
end;
$$;

create or replace function public.trg_recurrence_generate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' and new.is_active then
    perform public.generate_recurrence_transactions(new.id);
  elsif TG_OP = 'UPDATE' and new.is_active and not old.is_active then
    perform public.generate_recurrence_transactions(new.id);
  end if;
  return new;
end;
$$;

-- extend_all_recurrences() call chain: pg_cron -> extend_all_recurrences() ->
-- generate_recurrence_transactions() per recurrence. The cron job runs as the
-- role that scheduled it (the migration/owner role), which still has EXECUTE via
-- ownership, so this revoke only removes the ability for ordinary API callers to
-- trigger a global batch run across every tenant. Supabase grants EXECUTE on new
-- public-schema functions directly to anon/authenticated (not just via the PUBLIC
-- pseudo-role), so both must be revoked explicitly.
revoke execute on function public.extend_all_recurrences() from public, anon, authenticated;

create index if not exists goals_account_id_idx on public.goals(account_id);
create index if not exists goals_category_id_idx on public.goals(category_id);
create index if not exists recurrences_account_id_idx on public.recurrences(account_id);
create index if not exists recurrences_category_id_idx on public.recurrences(category_id);
create index if not exists transactions_created_by_idx on public.transactions(created_by);
create index if not exists transactions_linked_transaction_id_idx on public.transactions(linked_transaction_id);
create index if not exists transactions_settled_by_idx on public.transactions(settled_by);
