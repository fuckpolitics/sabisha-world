
create table private.single_world(id boolean primary key default true check(id),content jsonb,revision bigint not null default 0,invite_token uuid not null default gen_random_uuid());
insert into private.single_world(id) values(true);
create table private.single_backups(revision bigint primary key,content jsonb,created_at timestamptz default now());
create table private.single_friends(id uuid primary key,name text,answers jsonb,created_at timestamptz default now());
alter table private.single_world enable row level security;
alter table private.single_backups enable row level security;
alter table private.single_friends enable row level security;
create function private.world_access(p_password text,p_action text,p_content jsonb default null,p_revision bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.single_world; result jsonb;
begin
if p_password is distinct from '2610' then raise exception 'wrong_password'; end if;
select * into w from private.single_world where id=true for update;
if p_action='open' then return to_jsonb(w);
elsif p_action='save' then
if p_revision is distinct from w.revision then raise exception 'revision_conflict'; end if;
if p_content is null or jsonb_typeof(p_content) <> 'object' or octet_length(p_content::text)>6000000 then raise exception 'invalid_content'; end if;
if w.content is not null then insert into private.single_backups values(w.revision,w.content,now()) on conflict do nothing; end if;
update private.single_world set content=p_content,revision=revision+1 where id=true;
delete from private.single_backups where revision not in(select revision from private.single_backups order by revision desc limit 30);
return to_jsonb(w.revision+1);
elsif p_action='inbox' then select coalesce(jsonb_agg(to_jsonb(f) order by created_at),'[]'::jsonb) into result from private.single_friends f; return result;
elsif p_action='history' then select coalesce(jsonb_agg(jsonb_build_object('revision',revision,'created_at',created_at) order by revision desc),'[]'::jsonb) into result from private.single_backups;return result;
elsif p_action='backup' then select content into result from private.single_backups where revision=p_revision; return result;
else raise exception 'invalid_action'; end if;
end $$;
revoke all on function private.world_access(text,text,jsonb,bigint) from public;
grant execute on function private.world_access(text,text,jsonb,bigint) to anon,authenticated;
create function public.sabisha_world(p_password text,p_action text,p_content jsonb default null,p_revision bigint default null) returns jsonb language sql security invoker set search_path='' as $$select private.world_access(p_password,p_action,p_content,p_revision)$$;
revoke all on function public.sabisha_world(text,text,jsonb,bigint) from public;
grant execute on function public.sabisha_world(text,text,jsonb,bigint) to anon,authenticated;
create function private.friend_send(p_invite uuid,p_submission_id uuid,p_name text,p_answers jsonb) returns boolean language plpgsql security definer set search_path='' as $$
begin
perform 1 from private.single_world where invite_token=p_invite for update;
if not found then raise exception 'invalid_invite';end if;
if exists(select 1 from private.single_friends where id=p_submission_id) then return true;end if;
if p_name is null or length(trim(p_name)) not between 1 and 100 or p_answers is null or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>10000 then raise exception 'invalid_answers';end if;
if (select count(*) from private.single_friends where created_at>now()-interval '1 hour')>=30 or (select count(*) from private.single_friends)>=1000 then raise exception 'rate_limit';end if;
insert into private.single_friends(id,name,answers) values(p_submission_id,trim(p_name),p_answers);
return true;
end $$;
revoke all on function private.friend_send(uuid,uuid,text,jsonb) from public;
grant execute on function private.friend_send(uuid,uuid,text,jsonb) to anon,authenticated;
create or replace function public.sabisha_submit_friend(p_invite uuid,p_submission_id uuid,p_name text,p_answers jsonb) returns boolean language sql security invoker set search_path='' as $$ select private.friend_send(p_invite,p_submission_id,p_name,p_answers) $$;

