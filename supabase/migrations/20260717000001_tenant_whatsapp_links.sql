-- Phase 3: WhatsApp number linking, one link per tenant at a time.
--
-- Flow: the app calls create_whatsapp_verification_code() to generate a
-- pending 6-digit code. The user sends that code to the platform's single
-- central WhatsApp number. The n8n workflow (outside this schema) calls
-- verify_whatsapp_link() with the code and the sender's normalized phone
-- number; on success it activates the link and revokes any previous active
-- link for that tenant (this is how a number swap works — see README).
-- Every inbound message afterwards resolves its tenant via
-- resolve_tenant_by_whatsapp(), never from message content.

create type public.whatsapp_link_status as enum ('pending', 'active', 'revoked');

create table public.tenant_whatsapp_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_number text,
  status public.whatsapp_link_status not null default 'pending',
  verification_code text not null,
  code_expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index tenant_whatsapp_links_tenant_id_idx on public.tenant_whatsapp_links(tenant_id);
create index tenant_whatsapp_links_verification_code_idx on public.tenant_whatsapp_links(verification_code);
create index tenant_whatsapp_links_phone_number_idx on public.tenant_whatsapp_links(phone_number);

-- Only one active link per phone number, and (implicitly, enforced by the
-- verify function below) only one active link per tenant.
create unique index tenant_whatsapp_links_active_phone_idx
  on public.tenant_whatsapp_links (phone_number)
  where status = 'active';

alter table public.tenant_whatsapp_links enable row level security;

create policy "whatsapp_links_select_members" on public.tenant_whatsapp_links
  for select using (public.is_tenant_member(tenant_id));

-- No insert/update/delete policies: every state transition goes through the
-- SECURITY DEFINER functions below (matches the create_tenant /
-- settle_transaction pattern from earlier phases), so a tenant member can't
-- directly forge an 'active' row or someone else's phone_number.

-- Generates a fresh pending verification code for the caller's tenant.
-- Overwrites any still-pending code for that tenant is NOT done here on
-- purpose — each call creates a new row, so a user can retry without
-- clobbering a code they may have already sent; stale pending rows simply
-- expire after 15 minutes and are never activated.
create or replace function public.create_whatsapp_verification_code(p_tenant_id uuid)
returns public.tenant_whatsapp_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_link public.tenant_whatsapp_links;
begin
  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'not authorized for this tenant';
  end if;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  insert into public.tenant_whatsapp_links (tenant_id, status, verification_code, code_expires_at)
  values (p_tenant_id, 'pending', v_code, now() + interval '15 minutes')
  returning * into v_link;

  return v_link;
end;
$$;

-- Called by the n8n workflow (as the anon role — the incoming WhatsApp
-- sender isn't a Supabase authenticated user) with the code texted to the
-- central number and that sender's normalized phone number (E.164/JID).
-- Activates the matching pending code, revokes the tenant's previous active
-- link (this is the "swap number" mechanism), and revokes any other active
-- link that happened to already claim this phone number.
create or replace function public.verify_whatsapp_link(p_code text, p_phone_number text)
returns table (out_tenant_id uuid, out_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.tenant_whatsapp_links%rowtype;
begin
  select * into v_link
  from public.tenant_whatsapp_links
  where verification_code = p_code
    and status = 'pending'
    and code_expires_at > now()
  order by created_at desc
  limit 1;

  if not found then
    return query select null::uuid, 'invalid_or_expired'::text;
    return;
  end if;

  update public.tenant_whatsapp_links
  set status = 'revoked'
  where tenant_id = v_link.tenant_id and status = 'active';

  update public.tenant_whatsapp_links
  set status = 'revoked'
  where phone_number = p_phone_number and status = 'active' and id <> v_link.id;

  update public.tenant_whatsapp_links
  set status = 'active', phone_number = p_phone_number, verified_at = now()
  where id = v_link.id;

  return query select v_link.tenant_id, 'active'::text;
end;
$$;

-- Called by the n8n workflow on every inbound message to resolve which
-- tenant (if any) the sender's phone number is actively linked to. Returns
-- null when there's no active link, which the workflow treats as "not
-- connected yet, reply with instructions to connect in the app".
create or replace function public.resolve_tenant_by_whatsapp(p_phone_number text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select tenant_id
  from public.tenant_whatsapp_links
  where phone_number = p_phone_number and status = 'active'
  limit 1;
$$;
