begin;
-- Disposable users exist only inside this rolled-back transaction.
create temp table test_ids as select gen_random_uuid() as alice, gen_random_uuid() as bob;
insert into auth.users(id,email) select alice,'test-alice@invalid.example' from test_ids;
insert into auth.users(id,email) select bob,'test-bob@invalid.example' from test_ids;
grant select on test_ids to authenticated, anon;
select set_config('request.jwt.claim.sub',(select alice::text from test_ids),true);
set local role authenticated;
select public.sabisha_init();
select public.sabisha_save('{"notes":[{"id":"one","text":"private note"}]}'::jsonb,0);
do $$begin
  if (select count(*) from public.sabisha_worlds)<>1 then raise exception 'owner read failed'; end if;
  begin
    perform public.sabisha_save('{}'::jsonb,0);
    raise exception 'stale write accepted';
  exception when others then
    if sqlerrm<>'revision_conflict' then raise; end if;
  end;
end$$;
select public.sabisha_save('{"notes":[{"id":"two","text":"next note"}]}'::jsonb,1);
do $$begin
  if (select count(*) from public.sabisha_backups)<>1 then raise exception 'backup missing'; end if;
end$$;
reset role;
create temp table invitation as select invite_token from public.sabisha_worlds where owner_id=(select alice from test_ids);
grant select on invitation to anon;
select set_config('request.jwt.claim.sub',(select bob::text from test_ids),true);
set local role authenticated;
select public.sabisha_init();
do $$begin
  if (select count(*) from public.sabisha_worlds)<>1 then raise exception 'cross-user leak'; end if;
  if (select count(*) from public.sabisha_backups)<>0 then raise exception 'backup leak'; end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select public.sabisha_submit_friend((select invite_token from invitation),gen_random_uuid(),'Test friend','{"music":"madk1d","wish":"Happy birthday"}'::jsonb);
do $$begin
  begin
    perform 1 from public.sabisha_worlds;
    raise exception 'anonymous world read allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.sabisha_questionnaires;
    raise exception 'anonymous questionnaire read allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.sabisha_submit_friend(gen_random_uuid(),gen_random_uuid(),'Test','{}'::jsonb);
    raise exception 'invalid invitation accepted';
  exception when others then if sqlerrm<>'invalid_invitation' then raise; end if; end;
end$$;
reset role;
select set_config('request.jwt.claim.sub',(select alice::text from test_ids),true);
set local role authenticated;
do $$begin if (select count(*) from public.sabisha_questionnaires)<>1 then raise exception 'questionnaire did not arrive'; end if; end$$;
reset role;
rollback;
select 'PASS: private owner reads, cross-user isolation, anonymous write-only questionnaire, backups, stale-write protection' as result;
