-- ============================================================================
-- SPOT · schema63_function_privileges.sql
--
-- EVERY SECURITY DEFINER function in `public` is callable by `anon` — that is,
-- by anyone holding the publishable key that ships inside the APK. Three of them
-- take privileged actions with no check on who is calling. All three were
-- verified by executing them as `anon` against this database inside a
-- rolled-back transaction:
--
--   notify(profile, actor, type, target, entity)
--       writes a row into `notifications` — the table schema35 deliberately gave
--       NO insert grant to anyone, with the comment «rows come from the triggers
--       below, which run as definer» — for ANY recipient, attributed to ANY
--       actor, of any type. Since schema61 it also sends the matching push. So a
--       stranger can make somebody's phone say «Aysel sənə mesaj yazdı» for a
--       message that does not exist, or manufacture match requests from people
--       who never asked. `notifications` has no provenance column: the forged
--       row is indistinguishable from a real one.
--       VERIFIED: as anon → row written.
--
--   admin_log(action, entity, entity_id, reason, meta)
--       appends to `audit_log`, which schema62's own comment calls «Append-only
--       record of admin decisions» — the record that exists precisely so a
--       moderator's actions can be reviewed later. It stamps `auth.uid()` and
--       inserts, with no admin check at all. There is no UPDATE or DELETE
--       policy, so forged rows can never be removed through the app.
--       VERIFIED: as anon → row written.
--
--   push_send(profile, title, body, data)
--       sends an arbitrary title and body to every device of any profile,
--       through SPOT's own Expo project — same icon, same channel, same sender.
--       A phishing push is therefore indistinguishable from a real SPOT push,
--       and nothing records that it happened.
--       VERIFIED: as anon → accepted.
--
-- WHY THE EXISTING LOCKS DID NOT HOLD. schema35, schema50 and schema61 each
-- wrote `revoke ... from public` (and schema50 also from anon/authenticated).
-- That is not enough on Supabase: the project ships an ALTER DEFAULT PRIVILEGES
-- entry that grants EXECUTE on every function created in `public` to `anon` and
-- `authenticated`. Revoking PUBLIC does not touch a grant made directly to a
-- role, and the default privilege re-applies it to every function created after
-- the revoke. So the lock was written, read as done, and was never in place.
-- Section 4 below removes the default itself, which is the only way this stops
-- recurring on the next function somebody adds.
--
-- ALSO CLOSED — read oracles. These answer questions about OTHER people to an
-- unauthenticated caller:
--   blocked_between(a,b)   the block graph, which schema38 says the app must
--                          never hand out ("who blocked whom" is exactly the
--                          fact a blocked person wants)
--   checkin_streak(pid)    anybody's gym-attendance streak, straight past
--                          `show_in_gym_list`
--   can_review_gym(g,who)  whether a named person has three check-ins at a named
--                          gym — a location-history probe
--   is_admin / admin_role / admin_at_least / is_sanctioned
--                          who the moderators are (profiles.user_id is readable,
--                          so the uid to test with is available), and who is
--                          currently banned
--   notif_enabled(p,type)  another person's notification settings
--   challenge_standings    participants' training volume, to signed-out callers
--   refresh_* (6 fns)      counter recomputes, callable by anyone as a write
--
-- TWO LOCKS, NOT ONE. Section 1 takes the privilege away; section 3 adds a check
-- inside the functions that policies still need to call. The privilege is the
-- one that can be undone by a careless `grant`; the body check cannot.
--
-- Apply AFTER schema62_grant_hardening.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Internal-only functions: executable by NOBODY but the definer chain
--
-- None of these has a client call site (grep of every `.rpc(` in src/ and
-- web/admin/src/ — the full list is: gyms_near, comments_for, search_handles,
-- video_save_count, touch_last_active, check_in, open_thread, my_storage_objects,
-- delete_my_account, create_day_pass, check_day_pass, redeem_day_pass,
-- challenge_standings, admin_dashboard, admin_profile_stats, admin_unmask_phone,
-- admin_decide_verification, admin_set_verification_note, admin_set_gym_claim,
-- admin_set_gym_listed). Trigger functions do not need EXECUTE at firing time,
-- and a SECURITY DEFINER calling another runs as the owner, so the real callers
-- keep working.
-- ----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (
         -- privileged actions with no caller check
         p.proname in ('notify','push_send','admin_log','require_admin',
                       'notif_enabled','checkin_streak',
                       'refresh_comment_count','refresh_gym_members','refresh_gym_rating',
                       'refresh_gym_trainers','refresh_trainer_clients','refresh_video_likes')
         -- every trigger body: invoked by the system, never by a client
         or pg_get_function_result(p.oid) = 'trigger'
         or pg_get_function_result(p.oid) = 'event_trigger'
       )
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon, authenticated',
                   r.proname, r.args);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Client RPCs: signed-in callers only
--
-- A guest browses SPOT through an ANONYMOUS SUPABASE SESSION, which is the
-- `authenticated` role — `anon` means a request carrying no session at all. So
-- taking `anon` away costs guest mode nothing, and it closes every one of these
-- to a bare key.
--
-- Deliberately left open to `anon`: gyms_near and gym_tonnage_ranking (the
-- catalogue and its aggregate ranking are public), comments_for, search_handles
-- and video_save_count (public read paths that can run before the anonymous
-- session finishes on a cold start).
-- ----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('challenge_standings','create_day_pass','check_day_pass','redeem_day_pass',
                         'delete_my_account','my_storage_objects','open_thread','check_in',
                         'touch_last_active','admin_dashboard','admin_profile_stats',
                         'admin_unmask_phone','admin_decide_verification','admin_set_gym_claim',
                         'admin_set_gym_listed','admin_set_trainer_verification',
                         'admin_set_verification_note')
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.args);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. The second lock: the functions RLS still needs, answering only about YOU
--
-- These stay executable — every one of them appears inside a policy, and a
-- policy is evaluated as the querying role, so taking EXECUTE away would break
-- reads for everybody. Instead each one now refuses to answer a question about
-- somebody else. Every real call site passes `auth.uid()` or `my_profile_id()`
-- as the subject, so nothing legitimate changes; a probe about a third party
-- gets `false`, which is also the safe direction for every policy that uses it.
-- ----------------------------------------------------------------------------

-- Who is a moderator is not public information: `profiles.user_id` is readable,
-- so without this anyone could walk the roster and find the staff accounts.
-- `disabled_at is null` is kept from schema4: a revoked admin is not an admin.
create or replace function public.is_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select uid is not null and uid = auth.uid()
     and exists (select 1 from public.admins a where a.user_id = uid and a.disabled_at is null);
$$;

create or replace function public.admin_role(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when uid is not null and uid = auth.uid()
              then (select a.role from public.admins a
                     where a.user_id = uid and a.disabled_at is null)
         end;
$$;

-- `admin_at_least` is left exactly as schema4 wrote it: it delegates to
-- `admin_role`, so it inherits the guard above without a second copy of the rule.

-- Whether an account is under sanction is moderation state, not public state.
create or replace function public.is_sanctioned(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select uid is not null and uid = auth.uid()
     and exists (
       select 1 from public.profiles p
        where p.user_id = uid
          and coalesce(p.status, 'active') <> 'active'
          and (p.status_until is null or p.status_until > now()));
$$;

-- The block graph. Every legitimate caller is one of the two parties: the
-- policies pass `my_profile_id()` as one side, `open_thread` passes `me`, and
-- `notify()` passes the acting user as the actor. A third party now gets
-- «not blocked», which is what every policy already does when there is no block.
-- `thread_blocked()` needs no change of its own — it calls this, so a non-member
-- probing a thread id now gets false through the same gate.
create or replace function public.blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when a is null or b is null then false
    when public.my_profile_id() is distinct from a
     and public.my_profile_id() is distinct from b then false
    else exists (
      select 1 from public.blocks bl
       where (bl.blocker_id = a and bl.blocked_id = b)
          or (bl.blocker_id = b and bl.blocked_id = a))
  end;
$$;

-- «Has this named person checked in at this named gym three times?» is a
-- location-history question. The reviews policy only ever asks it about the
-- row's own author, which is the caller. The count itself is unchanged.
create or replace function public.can_review_gym(p_gym_id text, p_author uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_author is not null
     and p_author = public.my_profile_id()
     and (select count(*) from public.check_ins c
           where c.gym_id = p_gym_id and c.profile_id = p_author) >= 3;
$$;

comment on function public.is_admin is
  'True only when `uid` is the CALLER and the caller is an admin whose access has not been revoked. It used to answer about any uid, to anyone with the publishable key — an oracle for locating the moderation staff.';
comment on function public.blocked_between is
  'True only when the caller is one of the two parties. Answering about a third pair handed out the block graph, which is the one fact a blocked person most wants hidden.';
comment on function public.can_review_gym is
  'Only about the caller. Asking it about somebody else was a probe into their gym check-in history.';

-- ----------------------------------------------------------------------------
-- 4. Stop it happening to the next function somebody writes
--
-- This is the actual root cause. Supabase installs a default privilege that
-- grants EXECUTE on every function created in `public` to `anon` and
-- `authenticated`. Three separate migrations wrote a lock that this silently
-- undid. Removing the default makes a new function private until somebody grants
-- it on purpose — which is the direction a mistake should fail in.
-- ----------------------------------------------------------------------------
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
