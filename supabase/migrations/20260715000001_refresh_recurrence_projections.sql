-- Phase 2: on-demand, tenant-scoped recurrence projection refresh.
--
-- extend_all_recurrences() (Phase 1) iterates every tenant's recurrences and is
-- intentionally locked down to postgres/service_role only (it's meant for a
-- scheduled job, not a client call). The app needs a safe, user-triggered
-- equivalent scoped to the caller's own tenant: "Atualizar Projeções" button on
-- the Recurrences screen.
--
-- generate_recurrence_transactions() (Phase 1) is already idempotent — it only
-- ever appends occurrences after the last one it generated — so calling this
-- repeatedly is safe and never duplicates transactions.
create or replace function public.refresh_recurrence_projections(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'not authorized for this tenant';
  end if;

  for rec in
    select id from public.recurrences
    where tenant_id = p_tenant_id
      and is_active = true
      and (end_date is null or end_date > current_date)
  loop
    perform public.generate_recurrence_transactions(rec.id);
  end loop;
end;
$$;
