-- ============================================================================
-- SPOT · schema5_app_writes.sql
-- Insert policies so the mobile app can WRITE the real data the admin manages.
-- Apply AFTER schema4_admin.sql (run once in the Supabase SQL Editor).
-- ============================================================================

-- day_passes: a user may create their own pass (admin refunds via schema4 policy).
drop policy if exists dp_user_insert on public.day_passes;
create policy dp_user_insert on public.day_passes for insert with check (auth.uid() = user_id);

-- profiles: a user may create + update THEIR OWN row (first-time upsert on save).
do $$ begin
  if not exists (select 1 from pg_policies where tablename='profiles' and policyname='profiles_self_insert') then
    create policy profiles_self_insert on public.profiles for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='profiles' and policyname='profiles_self_update') then
    create policy profiles_self_update on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

-- check_ins: a user may create their own check-in (drives "who is here" + admin stats).
do $$ begin
  if not exists (select 1 from pg_policies where tablename='check_ins' and policyname='checkins_self_insert') then
    create policy checkins_self_insert on public.check_ins for insert with check (
      exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid())
    );
  end if;
end $$;

-- trainer_verifications / gym_claims already have self-insert policies in schema4.
-- reports already has reports_insert in schema4.
