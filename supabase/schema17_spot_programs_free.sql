-- ============================================================================
-- SPOT · schema17_spot_programs_free.sql
--
-- Found on device: the program library showed a «15 ₼» badge on «Güc bazası —
-- 5×5», a plan now credited to SPOT itself (schema10). SPOT takes no money at
-- all, so a price tag on its own starter plan reads as something to buy.
--
-- Verified before writing: `strength-5x5` is the only row with paid = true.
--
-- Prices elsewhere in the app (gym membership, day pass, a trainer's rate) stay
-- — they are informational, and those screens say so out loud. What cannot
-- stand is SPOT appearing to charge for its own content.
--
-- Apply AFTER schema16_level_language.sql.
-- ============================================================================

update public.programs
   set paid = false,
       price = null
 where creator_type = 'spot'
    or creator_name = 'SPOT';

-- Structural, so it cannot come back: a SPOT-authored plan is free by definition.
alter table public.programs drop constraint if exists programs_spot_is_free;
alter table public.programs add constraint programs_spot_is_free
  check (
    coalesce(creator_type, '') <> 'spot'
    or (coalesce(paid, false) = false and price is null)
  );
