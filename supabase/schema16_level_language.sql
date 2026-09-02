-- ============================================================================
-- SPOT · schema16_level_language.sql
--
-- Found on device: the partner list rendered «Günel Rəhimova · beginner» — an
-- English word in an Azerbaijani-only product.
--
-- Verified before writing: public.profiles.level holds a mix of the app's own
-- Azerbaijani values and English ones left by an earlier seeding script —
--   Orta 9, beginner 6, NULL 4, intermediate 4, advanced 2.
-- The client's type is `'Başlanğıc' | 'Orta' | 'İrəli'` and the screens print
-- the stored string straight out, so anything else leaks to the user as-is.
--
-- Apply AFTER schema15_seed_people.sql.
-- ============================================================================

update public.profiles set level = 'Başlanğıc' where lower(btrim(level)) in ('beginner', 'basic', 'novice');
update public.profiles set level = 'Orta'      where lower(btrim(level)) in ('intermediate', 'medium');
update public.profiles set level = 'İrəli'     where lower(btrim(level)) in ('advanced', 'expert', 'pro');

-- Same leak, same fix, on the two other tables that carry a level.
update public.programs set level = 'Başlanğıc' where lower(btrim(level)) in ('beginner', 'basic', 'novice');
update public.programs set level = 'Orta'      where lower(btrim(level)) in ('intermediate', 'medium');
update public.programs set level = 'İrəli'     where lower(btrim(level)) in ('advanced', 'expert', 'pro');

-- Keep it from happening again. NULL stays allowed — "not stated" is honest, and
-- the client already renders a missing level as nothing rather than guessing.
alter table public.profiles drop constraint if exists profiles_level_check;
alter table public.profiles add constraint profiles_level_check
  check (level is null or level in ('Başlanğıc', 'Orta', 'İrəli'));

alter table public.programs drop constraint if exists programs_level_check;
alter table public.programs add constraint programs_level_check
  check (level is null or level in ('Başlanğıc', 'Orta', 'İrəli'));
