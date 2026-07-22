-- Phase 1: business-logic functions and triggers.
--   1. transactions.updated_at maintenance.
--   2. Recurrence -> projected transactions generation (12-month rolling window).
--   3. settle_transaction(): the only supported way to turn a projected
--      transaction into a realized one without duplicating it.

-- 1. updated_at maintenance -------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- 2. Recurrence generation ---------------------------------------------------

-- Computes the next occurrence date after p_from_date for a given recurrence rule.
create or replace function public.next_recurrence_date(
  p_interval public.recurrence_interval,
  p_reference_day smallint,
  p_reference_month smallint,
  p_from_date date
)
returns date
language plpgsql
immutable
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
  else -- yearly
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

-- Generates 'projected' transactions for a recurrence, from the later of
-- start_date / the last already-generated occurrence, up to 12 months from today
-- (or end_date, whichever comes first). Safe to call repeatedly: it only ever
-- appends occurrences after the last one it already generated.
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

  if r.end_date is not null and r.end_date < v_horizon then
    v_horizon := r.end_date;
  end if;

  select max(date) into v_last_date
  from public.transactions
  where recurrence_id = p_recurrence_id;

  if v_last_date is null then
    -- First run: the start_date itself is the first occurrence if it already
    -- matches the rule, otherwise the next matching date on/after start_date.
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

create trigger recurrences_generate_trigger
  after insert or update on public.recurrences
  for each row execute function public.trg_recurrence_generate();

-- Rolls the 12-month generation window forward for every active recurrence.
-- Intended to run on a schedule (see README: "Recurrence generation" section for
-- the pg_cron setup) so windows don't go stale as time passes and start_date-based
-- generation alone would never top up.
create or replace function public.extend_all_recurrences()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  for rec in
    select id from public.recurrences
    where is_active = true and (end_date is null or end_date > current_date)
  loop
    perform public.generate_recurrence_transactions(rec.id);
  end loop;
end;
$$;

-- Schedule extend_all_recurrences() via pg_cron when available. pg_cron is a
-- managed extension on Supabase (enable it under Database > Extensions); it is
-- not available in every local/CI Postgres, so this is best-effort and silently
-- skipped otherwise. See README for the manual alternative.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'extend-recurrences-monthly',
      '0 3 1 * *',
      $cron$select public.extend_all_recurrences();$cron$
    );
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end;
$$;

-- 3. Settling a projected transaction ----------------------------------------

-- Turns a projected transaction into a realized one WITHOUT duplicating it:
-- inserts a new 'realized' row linked back to the original via
-- linked_transaction_id, and stamps the original projected row's settled_by so
-- it's excluded from "still pending" queries. Returns the new realized row.
create or replace function public.settle_transaction(
  p_projected_id uuid,
  p_realized_date date default null,
  p_realized_amount numeric default null
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_projected public.transactions%rowtype;
  v_realized public.transactions%rowtype;
begin
  select * into v_projected from public.transactions where id = p_projected_id;

  if not found then
    raise exception 'transaction % not found', p_projected_id;
  end if;

  if not public.is_tenant_member(v_projected.tenant_id) then
    raise exception 'not authorized for this tenant';
  end if;

  if v_projected.status <> 'projected' then
    raise exception 'transaction % is not projected', p_projected_id;
  end if;

  if v_projected.settled_by is not null then
    raise exception 'transaction % is already settled', p_projected_id;
  end if;

  insert into public.transactions (
    tenant_id, account_id, category_id, description, amount, type,
    date, status, form, installment_group_id, installment_number, installment_total,
    linked_transaction_id, recurrence_id, created_by
  ) values (
    v_projected.tenant_id, v_projected.account_id, v_projected.category_id,
    v_projected.description, coalesce(p_realized_amount, v_projected.amount), v_projected.type,
    coalesce(p_realized_date, v_projected.date), 'realized', v_projected.form,
    v_projected.installment_group_id, v_projected.installment_number, v_projected.installment_total,
    v_projected.id, v_projected.recurrence_id, auth.uid()
  ) returning * into v_realized;

  update public.transactions set settled_by = v_realized.id where id = v_projected.id;

  return v_realized;
end;
$$;
