-- Private owner data; visitors can only submit a questionnaire using an invitation.
create table public.sabisha_worlds (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  content jsonb,
  revision bigint not null default 0,
  invite_token uuid not null unique default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
create table public.sabisha_backups (
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, revision)
);
create table public.sabisha_questionnaires (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  answers jsonb not null,
  created_at timestamptz not null default now()
);
create index sabisha_questionnaires_owner_date on public.sabisha_questionnaires(owner_id, created_at);
alter table public.sabisha_worlds enable row level security;
alter table public.sabisha_backups enable row level security;
alter table public.sabisha_questionnaires enable row level security;
revoke all on public.sabisha_worlds, public.sabisha_backups, public.sabisha_questionnaires from anon, authenticated;
grant select on public.sabisha_worlds, public.sabisha_backups, public.sabisha_questionnaires to authenticated;
create policy "owner reads own world" on public.sabisha_worlds for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner reads own backups" on public.sabisha_backups for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner reads own questionnaires" on public.sabisha_questionnaires for select to authenticated using (owner_id = (select auth.uid()));

create function public.sabisha_init() returns public.sabisha_worlds
language plpgsql security definer set search_path = '' as $$
declare result public.sabisha_worlds;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  insert into public.sabisha_worlds(owner_id) values (auth.uid()) on conflict (owner_id) do nothing;
  select * into result from public.sabisha_worlds where owner_id=auth.uid();
  return result;
end; $$;
revoke all on function public.sabisha_init() from public, anon;
grant execute on function public.sabisha_init() to authenticated;

create function public.sabisha_save(p_content jsonb, p_expected_revision bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare current_world public.sabisha_worlds; new_revision bigint;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_content is null or jsonb_typeof(p_content)<>'object' or octet_length(p_content::text)>6000000 then raise exception 'invalid_content'; end if;
  select * into current_world from public.sabisha_worlds where owner_id=auth.uid() for update;
  if not found then raise exception 'world_not_initialized'; end if;
  if current_world.revision<>p_expected_revision then raise exception 'revision_conflict'; end if;
  if current_world.content is not null then
    insert into public.sabisha_backups(owner_id,revision,content) values(auth.uid(),current_world.revision,current_world.content) on conflict do nothing;
  end if;
  new_revision:=current_world.revision+1;
  update public.sabisha_worlds set content=p_content,revision=new_revision,updated_at=now() where owner_id=auth.uid();
  delete from public.sabisha_backups where owner_id=auth.uid() and revision not in (select revision from public.sabisha_backups where owner_id=auth.uid() order by revision desc limit 30);
  return new_revision;
end; $$;
revoke all on function public.sabisha_save(jsonb,bigint) from public, anon;
grant execute on function public.sabisha_save(jsonb,bigint) to authenticated;

create function public.sabisha_submit_friend(p_invite uuid,p_submission_id uuid,p_name text,p_answers jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare target_owner uuid; item record;
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 100 or p_answers is null or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>5000 then raise exception 'invalid_questionnaire'; end if;
  for item in select key,value from jsonb_each(p_answers) loop
    if item.key not in ('nickname','birthday','music','hobbies','memory','wish') or jsonb_typeof(item.value)<>'string' or length(item.value #>> '{}')>600 then raise exception 'invalid_answer'; end if;
  end loop;
  select owner_id into target_owner from public.sabisha_worlds where invite_token=p_invite for update;
  if not found then raise exception 'invalid_invitation'; end if;
  if exists(select 1 from public.sabisha_questionnaires where id=p_submission_id and owner_id=target_owner) then return true; end if;
  if (select count(*) from public.sabisha_questionnaires where owner_id=target_owner and created_at>now()-interval '1 hour')>=30 then raise exception 'too_many_submissions'; end if;
  if (select count(*) from public.sabisha_questionnaires where owner_id=target_owner)>=1000 then raise exception 'questionnaire_limit'; end if;
  insert into public.sabisha_questionnaires(id,owner_id,name,answers) values(p_submission_id,target_owner,btrim(p_name),p_answers);
  return true;
end; $$;
revoke all on function public.sabisha_submit_friend(uuid,uuid,text,jsonb) from public;
grant execute on function public.sabisha_submit_friend(uuid,uuid,text,jsonb) to anon, authenticated;

create function public.sabisha_rotate_invite() returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  update public.sabisha_worlds set invite_token=gen_random_uuid() where owner_id=auth.uid() returning invite_token into result;
  return result;
end; $$;
revoke all on function public.sabisha_rotate_invite() from public, anon;
grant execute on function public.sabisha_rotate_invite() to authenticated;
