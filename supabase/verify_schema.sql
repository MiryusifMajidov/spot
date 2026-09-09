-- ============================================================================
-- SPOT · verify_schema.sql   — READ ONLY. Run in Supabase → SQL Editor.
--
-- WHAT THIS IS
--   A pure diagnostic. It creates nothing, alters nothing, writes nothing.
--   There is no CREATE / ALTER / DROP / INSERT / UPDATE / DELETE anywhere in
--   this file. It only reads information_schema, pg_catalog and storage.buckets.
--
-- WHY IT EXISTS
--   Almost every read path in the SPOT client swallows its error and keeps the
--   local seed data on screen (src/lib/hooks.ts:24-26, src/lib/focusFetch.ts:61),
--   and five of the app's writes never check `error` at all (src/lib/api.ts:261,
--   262, 278, 315, 420). The admin panel does the same (web/admin/src/screens/*
--   all do `(x.data as T[]) ?? []`). A missing table, column, policy or default
--   therefore looks EXACTLY like "no data yet" in the UI. The only honest way to
--   know what the live database actually has is to ask the database.
--
-- HOW TO READ THE OUTPUT
--   One result set. MISSING rows are sorted to the top. If the top row says OK,
--   everything the client code requires is present.
--     check_kind : table | column | bucket | rpc | policy | trigger | extension
--                  | constraint | type      (the last two are additions; the
--                  client breaks on them just as hard as on a missing column)
--     object     : e.g. 'gyms.lat'
--     status     : 'OK' or 'MISSING' (any not-OK result is reported as MISSING;
--                  the reason — wrong type, wrong FK target, no default — is in
--                  `detail`, so the at-a-glance contract stays two-valued)
--     detail     : the observed fact, or what the code needs and why
--
-- It must not error on a database that is missing things. Every check is a LEFT
-- JOIN or an EXISTS against a catalog, so absent objects yield rows, not faults.
-- ============================================================================

with

-- ---------------------------------------------------------------------------
-- catalog helpers
-- ---------------------------------------------------------------------------
uniq as (
  -- every UNIQUE index in public, as a sorted array of its column names
  select
    t.relname::text as tbl,
    (select array_agg(a.attname::text order by a.attname)
       from unnest(string_to_array(i.indkey::text, ' ')::int[]) as k(attnum)
       join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum) as cols
  from pg_index i
  join pg_class t     on t.oid = i.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where i.indisunique and n.nspname = 'public'
),
fks as (
  -- every FOREIGN KEY in public, one row per constrained column
  select
    cl.relname::text  as tbl,
    att.attname::text as col,
    (fns.nspname || '.' || fcl.relname)::text as target
  from pg_constraint con
  join pg_class     cl  on cl.oid  = con.conrelid
  join pg_namespace ns  on ns.oid  = cl.relnamespace and ns.nspname = 'public'
  join pg_class     fcl on fcl.oid = con.confrelid
  join pg_namespace fns on fns.oid = fcl.relnamespace
  join unnest(con.conkey) as k(attnum) on true
  join pg_attribute att  on att.attrelid = cl.oid and att.attnum = k.attnum
  where con.contype = 'f'
),
checks as (
  -- all CHECK constraint definitions per table, concatenated
  select cl.relname::text as tbl,
         string_agg(pg_get_constraintdef(con.oid), ' ; ') as defs
  from pg_constraint con
  join pg_class     cl on cl.oid = con.conrelid
  join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
  where con.contype = 'c'
  group by cl.relname
),

-- ---------------------------------------------------------------------------
-- EXPECTATIONS — every one traced to a call site in the client or admin panel
-- ---------------------------------------------------------------------------

expected_tables(t, why) as (values
  ('gyms'::text,                  'src/lib/api.ts:124 getGyms'::text),
  ('profiles',                    'src/lib/api.ts:61 getMyProfile'),
  ('check_ins',                   'src/lib/api.ts:104 activeCountsByGym'),
  ('match_requests',              'src/lib/api.ts:237 sendMatchRequest'),
  ('trainers',                    'src/lib/hooks.ts:218 useTrainers'),
  ('exercises',                   'src/lib/hooks.ts:238 useDayExercises'),
  ('programs',                    'src/lib/hooks.ts:128 usePrograms'),
  ('reviews',                     'src/lib/hooks.ts:322 useReviews'),
  ('challenges',                  'src/lib/hooks.ts useChallenges'),
  ('challenge_members',           'src/lib/social.ts joinChallenge — the opt-in challenge_standings ranks'),
  ('feed_videos',                 'src/lib/hooks.ts:279 useFeedVideos'),
  ('community_posts',             'src/lib/hooks.ts:288 useCommunityPosts'),
  ('chat_threads',                'schema42 open_thread — a thread exists only after an accepted match or trainer link'),
  ('messages',                    'src/lib/hooks.ts:301 useMessages'),
  ('prs',                         'src/lib/api.ts:420 logPR'),
  ('workouts',                    'src/lib/api.ts:405 logWorkout'),
  ('progress',                    'src/lib/api.ts:427 logWeight'),
  ('meals',                       'src/lib/hooks.ts:307 useMeals'),
  ('shop_items',                  'src/lib/hooks.ts:313 useShopItems'),
  ('trainer_requests',            'src/lib/roles.ts:53 requestTrainer'),
  ('student_programs',            'src/lib/roles.ts:142 assignStudentProgram'),
  ('trainer_verifications',       'src/app/trainer/verify.tsx:71'),
  ('gym_claims',                  'src/lib/gymOwner.tsx:195 submitGymClaim'),
  ('day_passes',                  'src/lib/api.ts createDayPass / getMyDayPass; src/app/gym/pass.tsx redeem'),
  ('reports',                     'src/lib/api.ts:329 createReport'),
  ('admins',                      'web/admin/src/lib/auth.tsx:34'),
  ('audit_log',                   'web/admin/src/lib/audit.ts:18 — every admin action'),
  ('report_messages',             'web/admin/src/screens/Moderation.tsx:129'),
  ('moderation_actions',          'web/admin/src/screens/Users.tsx:151'),
  ('push_tokens',                 'src/lib/push.ts registerPush — schema61; without it no notification ever leaves the database')
),

expected_columns(t, c, why) as (values
  -- profiles ---------------------------------------------------------------
  ('profiles'::text,'id'::text,                'src/lib/api.ts:261 .eq(id); FK written everywhere'::text),
  ('profiles','user_id',                       'src/lib/api.ts:61 .eq(user_id) + upsert conflict target'),
  ('profiles','name',                          'src/lib/api.ts:174; src/lib/roles.ts:89'),
  ('profiles','gender',                        'src/lib/api.ts:177'),
  ('profiles','age',                           'src/lib/roles.ts:89 explicit select — breaks trainer students screen'),
  ('profiles','home_gym_id',                   'src/lib/api.ts:210 .eq(home_gym_id); src/lib/roles.ts:192'),
  ('profiles','level',                         'src/lib/roles.ts:89, :192 explicit selects'),
  ('profiles','goals',                         'src/lib/roles.ts:89, :192 explicit selects (text[])'),
  ('profiles','types',                         'src/lib/api.ts:33 / appStore.ts:72 write'),
  ('profiles','time_slot',                     'src/lib/api.ts:34 / appStore.ts:73 write'),
  ('profiles','bio',                           'src/lib/api.ts:35 / appStore.ts:74 write'),
  ('profiles','visibility',                    'src/app/(tabs)/profile/privacy.tsx:36 write'),
  ('profiles','show_in_gym_list',              'src/app/(tabs)/profile/privacy.tsx:36; src/lib/gymOwner.tsx:268'),
  ('profiles','role',                          'src/lib/api.ts:261 write; src/app/trainer/_layout.tsx:14 gate'),
  ('profiles','specialty',                     'src/lib/api.ts:261 write'),
  ('profiles','price_from',                    'src/lib/api.ts:261 write'),
  ('profiles','avatar_url',                    'src/lib/images.ts:59 setMyAvatar (schema8)'),
  ('profiles','created_at',                    'src/lib/gymOwner.tsx:268 roster; web/admin Users.tsx:74 order'),
  ('profiles','phone',                         'web/admin/src/screens/Users.tsx:214 + admin_unmask_phone'),
  ('profiles','status',                        'web/admin/src/screens/Users.tsx:149 write'),
  ('profiles','status_reason',                 'web/admin/src/screens/Users.tsx:149 write'),
  -- reports_count / requests_sent / requests_answered / streak_current are NOT
  -- columns and must not become any: they are COUNTED by admin_profile_stats
  -- (schema20) and merged in at Users.tsx:137. A stored counter is a number that
  -- can drift away from the thing it claims to count.
  ('profiles','last_active_at',                'web/admin/src/screens/Users.tsx:569'),
  -- gyms -------------------------------------------------------------------
  ('gyms','id',                                'src/lib/api.ts:295 insert (TEXT id "usr-<b36>")'),
  ('gyms','name',                              'src/lib/api.ts:79; hooks.ts:263 explicit select'),
  ('gyms','verified',                          'src/lib/api.ts:80'),
  ('gyms','district',                          'src/lib/api.ts:81; gym/edit.tsx:236 write'),
  ('gyms','hours',                             'src/lib/api.ts:83; gym/edit.tsx:237 write'),
  ('gyms','price_month',                       'src/lib/api.ts:84; gym/edit.tsx:239 write'),
  ('gyms','day_pass',                          'src/lib/api.ts:85 — feeds buyDayPass price'),
  ('gyms','members',                           'src/lib/hooks.ts:263 explicit select; admin Gyms.tsx:40 ORDER BY'),
  ('gyms','trainers',                          'src/lib/api.ts:87; api.ts:303 insert'),
  ('gyms','rating',                            'src/lib/api.ts:88'),
  ('gyms','review_count',                      'src/lib/api.ts:89'),
  ('gyms','amenities',                         'src/lib/api.ts:306 insert (text[])'),
  ('gyms','tags',                              'src/lib/api.ts:307 insert (text[])'),
  ('gyms','about',                             'src/lib/api.ts:308 insert'),
  ('gyms','image_url',                         'src/lib/images.ts:87 setGymCover write'),
  ('gyms','tons',                              'src/lib/hooks.ts:263 EXPLICIT select — gym ranking dies without it'),
  ('gyms','owner_id',                          'src/lib/roles.ts:186 getMyGymId — whole gym-owner panel'),
  ('gyms','claim_status',                      'src/lib/gymOwner.tsx:200 write; api.ts:311 insert'),
  ('gyms','schedule',                          'src/lib/gymOwner.tsx:158 write (schema7) — /gym/classes'),
  ('gyms','allow_day_pass',                    'src/lib/gymOwner.tsx:70/136 (schema7)'),
  ('gyms','show_members',                      'src/lib/gymOwner.tsx:71/136 (schema7)'),
  ('gyms','photos',                            'src/lib/images.ts:96 addGymPhoto write (schema8)'),
  ('gyms','lat',                               'src/app/gym/edit.tsx:247 write (schema8)'),
  ('gyms','lng',                               'src/app/gym/edit.tsx:247 write (schema8)'),
  ('gyms','location',                          'gyms_near RPC + schema8 sync trigger target'),
  -- check_ins --------------------------------------------------------------
  ('check_ins','id',                           'PK'),
  ('check_ins','profile_id',                   'src/lib/api.ts:143 insert; api.ts:201 select'),
  ('check_ins','gym_id',                       'src/lib/api.ts:143 insert; roles.ts:200 filter'),
  ('check_ins','created_at',                   'src/lib/roles.ts:199-202 30d window; roles.ts:226 occupancy'),
  ('check_ins','expires_at',                   'src/lib/api.ts:104/201 .gt() — the "indi zalda" counter'),
  -- match_requests ---------------------------------------------------------
  ('match_requests','id',                      'PK'),
  ('match_requests','from_profile',            'src/lib/api.ts:237 insert; api.ts:549 .or()'),
  ('match_requests','to_profile',              'src/lib/api.ts:237 insert; api.ts:549 .or()'),
  ('match_requests','status',                  'src/lib/api.ts:548 .eq(status,accepted)'),
  -- trainers ---------------------------------------------------------------
  ('trainers','id',                            'src/lib/api.ts:263 upsert PK = profiles.id (TEXT column)'),
  ('trainers','name',                          'src/lib/api.ts:264; admin Trainers.tsx:54 ORDER BY'),
  ('trainers','verified',                      'src/lib/api.ts:265; admin Trainers.tsx:54 .eq filter'),
  ('trainers','gym_id',                        'src/lib/hooks.ts:231 .eq(gym_id)'),
  ('trainers','specialty',                     'src/lib/api.ts:267'),
  ('trainers','rating',                        'src/lib/api.ts:268'),
  ('trainers','clients',                       'src/lib/api.ts:269'),
  ('trainers','response_time',                 'src/lib/api.ts:270'),
  ('trainers','price_from',                    'src/lib/api.ts:271'),
  ('trainers','bio',                           'src/lib/api.ts:272'),
  ('trainers','certifications',                'src/lib/api.ts:273 (text[])'),
  ('trainers','owner_id',                      'src/lib/roles.ts:45 getMyTrainerId — whole trainer panel'),
  ('trainers','verify_status',                 'src/lib/api.ts:275 write; admin Trainers.tsx:135'),
  ('trainers','photo_url',                     'src/lib/images.ts:68 setTrainerPhoto write (schema8)'),
  ('trainers','cert_urls',                     'src/lib/images.ts:79 addTrainerCert write (schema8)'),
  -- exercises / meals / shop_items / chats / messages -----------------------
  ('exercises','id',                           'src/lib/hooks.ts:240'),
  ('exercises','name',                         'src/lib/hooks.ts:240'),
  ('exercises','muscle',                       'src/lib/hooks.ts:240'),
  ('exercises','sets',                         'src/lib/hooks.ts:240'),
  ('exercises','reps',                         'src/lib/hooks.ts:240'),
  ('exercises','common_mistake',               'src/lib/hooks.ts:241'),
  ('exercises','substitutes',                  'src/lib/hooks.ts:241 (text[])'),
  ('meals','id',                               'src/lib/hooks.ts:118'),
  ('meals','name',                             'src/lib/hooks.ts:118'),
  ('meals','slot',                             'src/lib/hooks.ts:118-119'),
  ('meals','kcal',                             'src/lib/hooks.ts:118'),
  ('meals','protein',                          'src/lib/hooks.ts:118'),
  ('meals','carb',                             'src/lib/hooks.ts:118'),
  ('meals','fat',                              'src/lib/hooks.ts:118'),
  ('meals','post_workout',                     'src/lib/hooks.ts:119'),
  ('meals','ingredients',                      'src/lib/hooks.ts:119 (text[])'),
  ('meals','ord',                              'src/lib/hooks.ts:307 ORDER BY'),
  ('shop_items','id',                          'src/lib/hooks.ts:121'),
  ('shop_items','name',                        'src/lib/hooks.ts:121'),
  ('shop_items','qty',                         'src/lib/hooks.ts:121'),
  ('shop_items','price',                       'src/lib/hooks.ts:121'),
  ('shop_items','ord',                         'src/lib/hooks.ts:313 ORDER BY'),
  ('chat_threads','id',                        'schema42 — open_thread returns it'),
  ('chat_threads','a_profile',                 'schema42 — least(me, other); the pair is ordered so a thread is unique'),
  ('chat_threads','b_profile',                 'schema42 — greatest(me, other)'),
  ('messages','id',                            'src/lib/hooks.ts:302'),
  ('messages','thread_id',                     'schema42 — src/lib/messages.ts; replaces the demo chat_id'),
  ('messages','sender_id',                     'schema42 — «from_me» is derived, never stored: a stored flag would be true for everyone'),
  ('messages','body',                          'src/lib/hooks.ts:302'),
  ('messages','created_at',                    'src/lib/hooks.ts:301 ORDER BY'),
  -- programs ---------------------------------------------------------------
  ('programs','id',                            'src/app/(tabs)/workout/create.tsx:145 (TEXT id "mine-<b36>")'),
  ('programs','title',                         'src/lib/hooks.ts:60; admin Content.tsx:69 ORDER BY'),
  ('programs','creator_name',                  'src/lib/hooks.ts:61'),
  ('programs','creator_type',                  'src/lib/hooks.ts:62'),
  ('programs','creator_verified',              'src/lib/hooks.ts:63'),
  ('programs','weeks',                         'src/lib/hooks.ts:64'),
  ('programs','days_per_week',                 'src/lib/hooks.ts:65'),
  ('programs','level',                         'src/lib/hooks.ts:66'),
  ('programs','goal',                          'src/lib/hooks.ts:67'),
  ('programs','paid',                          'src/lib/hooks.ts:68'),
  ('programs','price',                         'src/lib/hooks.ts:69; admin Content.tsx:297'),
  ('programs','rating',                        'src/lib/hooks.ts:70'),
  ('programs','minutes',                       'src/lib/hooks.ts:71'),
  ('programs','video_count',                   'src/lib/hooks.ts:72'),
  ('programs','done_by',                       'src/lib/hooks.ts:73'),
  ('programs','has_meal_plan',                 'src/lib/hooks.ts:74'),
  ('programs','tags',                          'src/lib/hooks.ts:75 (text[])'),
  ('programs','saves',                         'src/lib/hooks.ts:128 ORDER BY — whole catalog fetch fails without it'),
  ('programs','days',                          'src/lib/hooks.ts:77 (jsonb)'),
  ('programs','owner_id',                      'src/app/(tabs)/workout/create.tsx:165 insert'),
  ('programs','description',                   'src/app/(tabs)/workout/create.tsx:165 insert — NO MIGRATION CREATES THIS'),
  -- reviews ----------------------------------------------------------------
  ('reviews','id',                             'src/lib/gymOwner.tsx:223; reply update key'),
  ('reviews','gym_id',                         'src/lib/hooks.ts:322 .eq(gym_id)'),
  ('reviews','name',                           'src/app/(tabs)/discover/gym/[id].tsx:158 insert'),
  ('reviews','tenure',                         'src/app/(tabs)/discover/gym/[id].tsx:159 insert (free text)'),
  ('reviews','rating',                         'src/app/(tabs)/discover/gym/[id].tsx:160 insert'),
  ('reviews','body',                           'src/app/(tabs)/discover/gym/[id].tsx:161 insert'),
  ('reviews','created_at',                     'src/lib/gymOwner.tsx:220 ORDER BY — getGymReviews throws without it'),
  ('reviews','reply',                          'src/lib/gymOwner.tsx:237 write (schema7)'),
  ('reviews','reply_at',                       'src/lib/gymOwner.tsx:237 write (schema7)'),
  -- challenges -------------------------------------------------------------
  ('challenges','id',                          'src/lib/hooks.ts:257; admin Challenges.tsx:138 (TEXT slug)'),
  ('challenges','title',                       'src/lib/hooks.ts:86'),
  ('challenges','scope',                       'src/lib/hooks.ts:86'),
  ('challenges','scope_label',                 'src/lib/hooks.ts:86'),
  ('challenges','description',                 'src/lib/hooks.ts mapChallenge'),
  ('challenges','target',                      'src/lib/hooks.ts mapChallenge'),
  ('challenges','unit',                        'src/lib/hooks.ts mapChallenge; decides what challenge_standings counts'),
  ('challenges','reward',                      'src/lib/hooks.ts mapChallenge'),
  ('challenges','participants',                'schema43 trigger keeps it — never written by a client'),
  ('challenges','active',                      'src/lib/hooks.ts useChallenges filter; admin Challenges.tsx toggle'),
  ('challenges','starts_at',                   'schema60 — replaces days_left; the window challenge_standings counts inside'),
  ('challenges','ends_at',                     'schema60 — the real deadline; admin Challenges.tsx date input'),
  -- progress / days_left / leaderboard / day_cells are GONE on purpose (schema60):
  -- a per-challenge «progress» belonged to nobody, days_left was an int nothing
  -- decremented, and the two jsonb columns held seeded rankings the app refused
  -- to draw. Do not add them back.
  -- feed_videos ------------------------------------------------------------
  ('feed_videos','id',                         'src/lib/api.ts:374 insert (TEXT id "uv-<b36>")'),
  ('feed_videos','author',                     'src/lib/api.ts:375'),
  ('feed_videos','verified',                   'src/lib/api.ts:376'),
  ('feed_videos','is_trainer',                 'src/lib/api.ts:377'),
  ('feed_videos','caption',                    'src/lib/api.ts:378'),
  ('feed_videos','hashtags',                   'src/lib/api.ts:379 (text[])'),
  ('feed_videos','likes',                      'src/lib/api.ts:380'),
  ('feed_videos','comments',                   'src/lib/api.ts:381'),
  ('feed_videos','linked_program_title',       'src/lib/api.ts:382'),
  ('feed_videos','linked_program_id',          'src/lib/api.ts:383 — writes '''' when unlinked'),
  ('feed_videos','gradient',                   'src/lib/api.ts:384 (text[])'),
  ('feed_videos','video_url',                  'src/lib/api.ts:385'),
  ('feed_videos','ord',                        'src/lib/hooks.ts:279 ORDER BY; admin Content.tsx:70'),
  -- community_posts --------------------------------------------------------
  ('community_posts','id',                     'src/lib/hooks.ts:108'),
  ('community_posts','author',                 'src/lib/api.ts:244 insert'),
  ('community_posts','gym',                    'src/lib/api.ts:245 insert (gym NAME, not id)'),
  ('community_posts','time_ago',               'src/lib/api.ts:246 insert'),
  ('community_posts','type',                   'src/lib/api.ts:247 insert'),
  ('community_posts','body',                   'src/lib/api.ts:248 insert'),
  ('community_posts','likes',                  'src/lib/api.ts:249 insert'),
  ('community_posts','comments',               'src/lib/api.ts:250 insert'),
  ('community_posts','stats',                  'src/lib/hooks.ts:111 (jsonb)'),
  ('community_posts','trainer_comment',        'src/lib/hooks.ts:111 (jsonb)'),
  ('community_posts','created_at',             'src/lib/hooks.ts:288 ORDER BY; admin Content.tsx:71'),
  -- workouts / prs / progress ---------------------------------------------
  ('workouts','id',                            'PK'),
  ('workouts','profile_id',                    'src/lib/api.ts:406 insert; api.ts:473 filter'),
  ('workouts','program_id',                    'src/lib/api.ts:407 insert'),
  ('workouts','title',                         'src/lib/api.ts:408 insert'),
  ('workouts','duration_sec',                  'src/lib/api.ts:409 / :524'),
  ('workouts','volume_kg',                     'src/lib/api.ts:410 / :472'),
  ('workouts','sets_done',                     'src/lib/api.ts:411'),
  ('workouts','rpe',                           'src/lib/api.ts:412'),
  ('workouts','created_at',                    'src/lib/api.ts:474 ORDER BY / :526 .gte'),
  ('prs','id',                                 'PK'),
  ('prs','profile_id',                         'src/lib/api.ts:420 insert'),
  ('prs','lift',                               'src/lib/api.ts:420 / :564'),
  ('prs','value',                              'src/lib/api.ts:420 / :564'),
  ('prs','delta',                              'src/lib/api.ts:420 / :564'),
  ('prs','created_at',                         'src/lib/api.ts:566 ORDER BY'),
  ('progress','id',                            'PK'),
  ('progress','profile_id',                    'src/lib/api.ts:427 insert'),
  ('progress','weight',                        'src/lib/api.ts:427 insert / :437 select'),
  ('progress','created_at',                    'src/lib/api.ts:439 / :453 ORDER BY'),
  -- trainer_requests / student_programs ------------------------------------
  ('trainer_requests','id',                    'src/lib/roles.ts:102 requestId; :129 update key'),
  ('trainer_requests','trainer_id',            'src/lib/roles.ts:54 write; :81 filter; onConflict target'),
  ('trainer_requests','from_profile',          'src/lib/roles.ts:54 write; :67 filter; onConflict target'),
  ('trainer_requests','note',                  'src/lib/roles.ts:54 write; :109 read'),
  ('trainer_requests','preferred_time',        'src/lib/roles.ts:54 write; :110 read'),
  ('trainer_requests','status',                'src/lib/roles.ts:54 write; :82 .in filter; :128 write'),
  ('trainer_requests','created_at',            'src/lib/roles.ts:83 ORDER BY — students query dies without it'),
  ('trainer_requests','decided_at',            'src/lib/roles.ts:128 write — accept/decline fails without it'),
  ('student_programs','trainer_id',            'src/lib/roles.ts:144 write; :90 filter; onConflict target'),
  ('student_programs','student_id',            'src/lib/roles.ts:145 write; :162 filter; onConflict target'),
  ('student_programs','program_id',            'src/lib/roles.ts:146 write'),
  ('student_programs','title',                 'src/lib/roles.ts:147 write; :90 select'),
  ('student_programs','note',                  'src/lib/roles.ts:148 write; :90 select'),
  ('student_programs','updated_at',            'src/lib/roles.ts:149 write; :163 ORDER BY'),
  -- trainer_verifications --------------------------------------------------
  ('trainer_verifications','id',               'src/app/trainer/verify.tsx:133 update key'),
  ('trainer_verifications','trainer_id',       'src/app/trainer/verify.tsx:179 insert (profiles.id)'),
  ('trainer_verifications','user_id',          'src/app/trainer/verify.tsx:74 filter (auth uid)'),
  ('trainer_verifications','status',           'src/app/trainer/verify.tsx:179 insert; admin Trainers.tsx:52 filter'),
  ('trainer_verifications','gym_confirm',      'src/app/trainer/verify.tsx:179 insert'),
  ('trainer_verifications','doc_cert_url',     'src/app/trainer/verify.tsx:132 update / :179 insert'),
  ('trainer_verifications','doc_id_url',       'admin Trainers.tsx:357 (document link the reviewer opens)'),
  ('trainer_verifications','intro_video_url',  'admin Trainers.tsx:415'),
  ('trainer_verifications','internal_note',    'admin Trainers.tsx:119 write'),
  ('trainer_verifications','reject_reason',    'src/app/trainer/verify.tsx:227; admin Trainers.tsx:151 write'),
  ('trainer_verifications','sla_due_at',       'admin Trainers.tsx:52 ORDER BY'),
  ('trainer_verifications','created_at',       'src/app/trainer/verify.tsx:75 ORDER BY'),
  -- gym_claims -------------------------------------------------------------
  ('gym_claims','id',                          'admin Gyms.tsx:107 update key'),
  ('gym_claims','gym_id',                      'src/lib/gymOwner.tsx:197 insert'),
  ('gym_claims','claimant_id',                 'src/lib/gymOwner.tsx:197 insert (auth uid)'),
  ('gym_claims','voen',                        'src/lib/gymOwner.tsx:197 insert'),
  ('gym_claims','status',                      'src/lib/gymOwner.tsx:197 insert; admin Gyms.tsx:41 filter'),
  ('gym_claims','reject_reason',               'src/app/gym/claim.tsx:128; admin Gyms.tsx:124 write'),
  ('gym_claims','call_code',                   'admin Gyms.tsx:160'),
  ('gym_claims','selfie_url',                  'admin Gyms.tsx:161'),
  ('gym_claims','sla_due_at',                  'admin Gyms.tsx:41 ORDER BY'),
  ('gym_claims','created_at',                  'src/lib/gymOwner.tsx:182 ORDER BY'),
  -- day_passes -------------------------------------------------------------
  ('push_tokens','token',                      'schema61 PK — Expo push token; PK is the TOKEN so a handed-over phone moves owner'),
  ('push_tokens','profile_id',                 'src/lib/push.ts registerPush; RLS owner check'),
  ('push_tokens','platform',                   'ios | android | web'),
  ('push_tokens','updated_at',                 'src/lib/push.ts upsert'),
  ('day_passes','id',                          'admin Payments.tsx:109 update key'),
  ('day_passes','user_id',                     'create_day_pass (schema59) — the client cannot insert here any more'),
  ('day_passes','gym_id',                      'create_day_pass; roles.ts getGymDayPasses filter'),
  ('day_passes','code',                        'create_day_pass — SERVER-generated; the client used to invent it'),
  ('day_passes','price',                       'create_day_pass, copied from gyms.day_pass. Never summed anywhere.'),
  ('day_passes','status',                      'active | used | refunded — redemption only; expiry lives in expires_at'),
  ('day_passes','used_at',                     'schema59 redeem_day_pass — when reception honoured it'),
  -- `commission` is GONE (schema27) and must stay gone: SPOT takes no money.
  ('day_passes','purchased_at',                'admin Payments.tsx:52 ORDER BY'),
  ('day_passes','expires_at',                  'src/lib/api.ts:357 insert'),
  ('day_passes','refunded_at',                 'admin Payments.tsx:108 write'),
  ('day_passes','refund_reason',               'admin Payments.tsx:108 write'),
  -- reports ----------------------------------------------------------------
  ('reports','id',                             'admin Moderation.tsx:118 update key'),
  ('reports','reporter_id',                    'src/lib/api.ts:330 insert (auth uid)'),
  ('reports','target_type',                    'src/lib/api.ts:331 insert'),
  ('reports','target_id',                      'src/lib/api.ts:332 insert (TEXT — holds ''support'')'),
  ('reports','category',                       'src/lib/api.ts:333 insert'),
  ('reports','note',                           'src/lib/api.ts:334 insert'),
  ('reports','status',                         'admin Moderation.tsx:85 filter, :138 write'),
  ('reports','sla_due_at',                     'admin Moderation.tsx:85 ORDER BY'),
  ('reports','created_at',                     'admin Moderation.tsx:86 ORDER BY'),
  ('reports','locked_by',                      'admin Moderation.tsx:117 write (15-min row lock)'),
  ('reports','locked_until',                   'admin Moderation.tsx:117 write'),
  ('reports','resolution',                     'admin Moderation.tsx:155 write'),
  ('reports','resolved_by',                    'admin Moderation.tsx:155 write'),
  ('reports','resolved_at',                    'admin Moderation.tsx:93 read + :155 write'),
  -- admin platform ---------------------------------------------------------
  ('admins','user_id',                         'web/admin/src/lib/auth.tsx:34'),
  ('admins','role',                            'web/admin/src/lib/auth.tsx:93 atLeast gate'),
  ('admins','name',                            'web/admin/src/lib/audit.ts:20'),
  ('admins','email',                           'web/admin/src/screens/AdminAudit.tsx:280'),
  ('admins','two_factor',                      'web/admin/src/screens/AdminAudit.tsx:264'),
  ('audit_log','id',                           'web/admin/src/screens/AdminAudit.tsx:431'),
  ('audit_log','admin_id',                     'web/admin/src/lib/audit.ts:19'),
  ('audit_log','admin_name',                   'web/admin/src/lib/audit.ts:20'),
  ('audit_log','action',                       'web/admin/src/lib/audit.ts:21'),
  ('audit_log','entity',                       'web/admin/src/lib/audit.ts:22'),
  ('audit_log','entity_id',                    'web/admin/src/lib/audit.ts:23'),
  ('audit_log','reason',                       'web/admin/src/lib/audit.ts:24'),
  ('audit_log','meta',                         'web/admin/src/lib/audit.ts:25 (jsonb)'),
  ('audit_log','created_at',                   'web/admin/src/screens/AdminAudit.tsx:85 ORDER BY'),
  ('report_messages','id',                     'admin Moderation.tsx:385'),
  ('report_messages','report_id',              'admin Moderation.tsx:130 filter'),
  ('report_messages','sender_name',            'admin Moderation.tsx:387'),
  ('report_messages','body',                   'admin Moderation.tsx:390'),
  ('report_messages','sent_at',                'admin Moderation.tsx:388'),
  ('report_messages','ord',                    'admin Moderation.tsx:130 ORDER BY'),
  ('moderation_actions','admin_id',            'admin Users.tsx:152 insert'),
  ('moderation_actions','target_type',         'admin Users.tsx:153 insert'),
  ('moderation_actions','target_id',           'admin Users.tsx:154; Content.tsx:73 read filter'),
  ('moderation_actions','action',              'admin Users.tsx:155; Content.tsx:73 .eq(content_remove)'),
  ('moderation_actions','reason',              'admin Users.tsx:156 insert'),
  ('moderation_actions','report_id',           'admin Moderation.tsx:151 insert (nullable — other sites omit it)')
),

-- Columns the client NEVER writes but always filters or orders on. Without a
-- server-side DEFAULT the row is written and then never matches the query.
expected_defaults(t, c, why) as (values
  ('check_ins'::text,'expires_at'::text,       'src/lib/api.ts:143 never writes it; api.ts:104/201 .gt() on it. No default => "indi zalda" is permanently 0 and nothing errors.'::text),
  ('check_ins','created_at',                   'src/lib/roles.ts:199-202/:226 window queries; never written by the client'),
  ('match_requests','status',                  'src/lib/api.ts:237 never writes it; api.ts:548 .eq(status,accepted)'),
  ('workouts','created_at',                    'src/lib/api.ts:405 never writes it; api.ts:474/:526 order + gte'),
  ('prs','created_at',                         'src/lib/api.ts:420 never writes it; api.ts:566 ORDER BY'),
  ('progress','created_at',                    'src/lib/api.ts:427 never writes it; api.ts:439/:453 ORDER BY'),
  ('trainer_requests','created_at',            'src/lib/roles.ts:54 never writes it; roles.ts:83 ORDER BY'),
  ('trainer_requests','id',                    'src/lib/roles.ts:54 never writes it; roles.ts:102 reads it back as requestId'),
  ('community_posts','created_at',             'src/lib/api.ts:243 never writes it; hooks.ts:288 ORDER BY'),
  ('reviews','created_at',                     'gym/[id].tsx:156 never writes it; gymOwner.tsx:220 ORDER BY'),
  ('reports','sla_due_at',                     'src/lib/api.ts:329 never writes it; admin Moderation.tsx:85 ORDER BY'),
  ('gym_claims','sla_due_at',                  'gymOwner.tsx:197 never writes it; admin Gyms.tsx:41 ORDER BY'),
  ('trainer_verifications','sla_due_at',       'verify.tsx:179 never writes it; admin Trainers.tsx:52 ORDER BY'),
  ('day_passes','purchased_at',                'src/lib/api.ts:350 never writes it; admin Payments.tsx:52 ORDER BY')
),

-- Column types the client depends on. A uuid PK where the code mints a text id
-- makes the whole create-flow fail on every attempt.
expected_types(t, c, ty, why) as (values
  ('gyms'::text,'id'::text,'text'::text,                       'src/lib/api.ts:293 mints "usr-<base36>" and inserts it at :295'::text),
  ('programs','id','text',                     'src/app/(tabs)/workout/create.tsx:145 inserts "mine-<base36>" (src/store/db.ts:399)'),
  ('feed_videos','id','text',                  'src/lib/api.ts:366 mints "uv-<base36>", inserted at :374'),
  ('challenges','id','text',                   'admin Challenges.tsx:138 inserts a slugify() slug'),
  ('trainers','id','text',                     'src/lib/api.ts:263 upserts profiles.id into it'),
  ('exercises','id','text',                    'schema2 seed ids are slugs ("bench","ohp")'),
  ('meals','id','text',                        'schema2 seed ids are slugs ("m1".."m4")'),
  ('shop_items','id','text',                   'schema2 seed ids are slugs ("s1".."s7")'),
  ('reports','target_id','text',               'src/app/(tabs)/profile/settings.tsx:35 writes the literal ''support'' — must be text with NO FK'),
  ('feed_videos','linked_program_id','text',   'src/lib/api.ts:383 writes '''' when nothing is linked — a uuid type or FK rejects every unlinked upload'),
  ('reviews','tenure','text',                  'gym/[id].tsx:159 writes "N check-in edib"'),
  ('gyms','lat','double precision',            'src/app/gym/edit.tsx:247 write'),
  ('gyms','lng','double precision',            'src/app/gym/edit.tsx:247 write'),
  ('gyms','schedule','jsonb',                  'src/lib/gymOwner.tsx:158 writes a JS array of {time,name,trainer}'),
  ('programs','days','jsonb',                  'create.tsx:161 writes [{title,focus,exercise_ids[]}]'),
  ('community_posts','stats','jsonb',          'src/lib/hooks.ts:111'),
  ('community_posts','trainer_comment','jsonb','src/lib/hooks.ts:111'),
  ('audit_log','meta','jsonb',                 'web/admin/src/lib/audit.ts:25 passes an object'),
  ('profiles','goals','ARRAY',                 'src/lib/roles.ts:107; admin Analytics.tsx:38 .neq(goals,{})'),
  ('profiles','types','ARRAY',                 'src/lib/api.ts:33 / appStore.ts:72'),
  ('gyms','amenities','ARRAY',                 'src/lib/gymOwner.tsx:63 read as an array'),
  ('gyms','tags','ARRAY',                      'src/lib/api.ts:307'),
  ('gyms','photos','ARRAY',                    'src/lib/images.ts:96-98 read/append as an array'),
  ('trainers','certifications','ARRAY',        'src/lib/api.ts:273'),
  ('trainers','cert_urls','ARRAY',             'src/lib/images.ts:77-79 read/append as an array'),
  ('feed_videos','hashtags','ARRAY',           'src/lib/api.ts:379'),
  ('feed_videos','gradient','ARRAY',           'src/lib/api.ts:384'),
  ('exercises','substitutes','ARRAY',          'src/lib/hooks.ts:241'),
  ('meals','ingredients','ARRAY',              'src/lib/hooks.ts:119')
),

-- UNIQUE indexes that PostgREST's onConflict= targets. Without a matching
-- unique index the upsert fails with 42P10 at runtime.
expected_unique(t, cols, why) as (values
  ('profiles'::text, array['user_id']::text[],                    'src/lib/api.ts:71 upsert onConflict:''user_id'' — profile saving fails for EVERY user without it'::text),
  ('trainer_requests', array['from_profile','trainer_id'],        'src/lib/roles.ts:55 upsert onConflict:''trainer_id,from_profile'''),
  ('student_programs', array['student_id','trainer_id'],          'src/lib/roles.ts:151 upsert onConflict:''trainer_id,student_id'''),
  ('trainers',         array['id'],                               'src/lib/api.ts:262 upsert uses the PK as the conflict target'),
  ('gyms',             array['id'],                               'PK — referenced as text by profiles.home_gym_id, check_ins.gym_id, day_passes.gym_id')
),

-- Foreign keys whose TARGET the client depends on (identity model).
expected_fk(t, c, target, why) as (values
  ('gyms'::text,'owner_id'::text,'public.profiles'::text,
     'src/lib/roles.ts:186 getMyGymId passes profiles.id. schema3.sql:14 declares profiles(id); schema4_admin.sql:28 declares auth.users(id) — "add column if not exists" means whichever ran FIRST won. If auth.users won, useMyGym() returns null and the whole gym-owner panel shows GymGate.'::text),
  ('trainers','owner_id','public.profiles',
     'src/lib/roles.ts:45 and src/lib/api.ts:274 both use profiles.id'),
  ('programs','owner_id','public.profiles',
     'schema3.sql:15 targets profiles(id) but create.tsx:165 writes getUserId() = the AUTH uid — the insert violates the FK and the retry at create.tsx:169 silently drops owner_id, leaving the program unowned and un-editable'),
  ('check_ins','profile_id','public.profiles',   'src/lib/api.ts:143 writes profiles.id'),
  ('trainer_requests','from_profile','public.profiles', 'src/lib/roles.ts:54'),
  ('student_programs','student_id','public.profiles',   'src/lib/roles.ts:145'),
  ('gym_claims','claimant_id','auth.users',      'src/lib/gymOwner.tsx:197 writes the auth uid'),
  ('trainer_verifications','user_id','auth.users','src/app/trainer/verify.tsx:179 writes the auth uid'),
  ('day_passes','user_id','auth.users',          'src/lib/api.ts:351 writes the auth uid'),
  ('reports','reporter_id','auth.users',         'src/lib/api.ts:330 writes the auth uid')
),

-- Exact string literals the code writes or filters on. If a CHECK constraint
-- exists on the column it must permit these values.
expected_literal(t, c, lit, why) as (values
  ('gyms'::text,'claim_status'::text,'pending'::text,        'src/lib/api.ts:311 insert; gymOwner.tsx:200 write'::text),
  ('gyms','claim_status','claimed',              'admin Gyms.tsx:112 write; gym/index.tsx:286 compare'),
  ('gyms','claim_status','unclaimed',            'src/lib/gymOwner.tsx:68 default'),
  ('trainers','verify_status','pending',         'src/lib/api.ts:275'),
  ('trainers','verify_status','approved',        'admin Trainers.tsx:135'),
  ('trainers','verify_status','rejected',        'admin Trainers.tsx:154'),
  ('trainer_verifications','status','pending',   'src/app/trainer/verify.tsx:179'),
  ('trainer_verifications','status','approved',  'admin Trainers.tsx:131'),
  ('trainer_verifications','status','rejected',  'admin Trainers.tsx:151'),
  ('gym_claims','status','pending',              'src/lib/gymOwner.tsx:197'),
  ('gym_claims','status','approved',             'admin Gyms.tsx:106'),
  ('gym_claims','status','rejected',             'admin Gyms.tsx:124'),
  ('day_passes','status','active',               'src/lib/api.ts:356 insert'),
  ('day_passes','status','used',                 'src/lib/roles.ts:244 .in filter'),
  ('day_passes','status','refunded',             'admin Payments.tsx:108 write'),
  ('day_passes','status','expired',              'web/admin/src/lib/types.ts:118'),
  ('trainer_requests','status','pending',        'src/lib/roles.ts:54'),
  ('trainer_requests','status','accepted',       'src/lib/roles.ts:128'),
  ('trainer_requests','status','declined',       'src/lib/roles.ts:128'),
  ('trainer_requests','status','ended',          'src/lib/roles.ts:21 type'),
  ('match_requests','status','accepted',         'src/lib/api.ts:548 filter — written by the admin side, must be permitted'),
  ('reports','status','open',                    'admin Moderation.tsx:85'),
  ('reports','status','resolved',                'admin Moderation.tsx:86'),
  ('reports','status','dismissed',               'admin Moderation.tsx:86'),
  ('reports','target_type','user',               'src/app/(tabs)/profile/settings.tsx:35'),
  ('reports','target_type','content',            'src/app/(tabs)/feed/index.tsx:446'),
  ('reports','target_type','gym',                'src/lib/api.ts:322'),
  ('reports','target_type','trainer',            'src/app/(tabs)/profile/become-trainer.tsx:281'),
  ('reports','target_type','message',            'src/lib/moderation.ts:6'),
  ('reports','category','safety',                'src/app/(tabs)/profile/settings.tsx:31'),
  ('reports','category','harassment',            'src/lib/moderation.ts:20'),
  ('reports','category','spam',                  'src/app/gym/reviews.tsx:83'),
  ('reports','category','fake',                  'src/app/gym/reviews.tsx:81'),
  ('reports','category','payment',               'src/lib/api.ts:324'),
  ('reports','category','other',                 'src/lib/api.ts:333 default'),
  ('moderation_actions','action','warn',         'admin Users.tsx:13'),
  ('moderation_actions','action','mute',         'admin Users.tsx:13'),
  ('moderation_actions','action','suspend',      'admin Users.tsx:13'),
  ('moderation_actions','action','ban',          'admin Users.tsx:13'),
  ('moderation_actions','action','content_remove','admin Content.tsx:140 write + :73 read filter'),
  ('moderation_actions','target_type','content', 'admin Moderation.tsx:26-28 remaps ''message''->''content'' precisely because the CHECK forbids ''message'''),
  ('profiles','status','active',                 'admin Users.tsx:28-33'),
  ('profiles','status','muted',                  'admin Users.tsx:28-33'),
  ('profiles','status','suspended',              'admin Users.tsx:28-33'),
  ('profiles','status','banned',                 'admin Users.tsx:28-33'),
  ('profiles','role','trainer',                  'src/lib/api.ts:261 write'),
  ('profiles','role','gym_admin',                'admin Users.tsx:22-26'),
  ('profiles','visibility','everyone',           'src/app/(tabs)/profile/privacy.tsx:36 + appStore.ts:37'),
  ('profiles','visibility','match-only',         'src/app/(tabs)/profile/privacy.tsx:36 + appStore.ts:37'),
  ('admins','role','support',                    'web/admin/src/lib/auth.tsx:93'),
  ('admins','role','owner',                      'web/admin/src/lib/auth.tsx:93'),
  ('challenges','scope','solo',                  'admin Challenges.tsx:27-31'),
  ('challenges','scope','city',                  'admin Challenges.tsx:27-31')
),

expected_buckets(b, why) as (values
  ('videos'::text,  'src/lib/api.ts:370 uploadFeedVideo + :372 getPublicUrl (must be PUBLIC)'::text),
  ('avatars', 'src/lib/images.ts:14/49/51 — avatars, trainer photos, certificates (must be PUBLIC)'),
  ('gyms',    'src/lib/images.ts:14/49/51 — gym cover + gallery (must be PUBLIC)')
),

expected_rpcs(f, why) as (values
  ('gyms_near'::text,          'src/lib/api.ts:115 rpc(gyms_near,{lat,lng}) — must return rows of (gym public.gyms, distance_km double precision); the mapper reads row.gym.id at api.ts:119'::text),
  ('admin_dashboard',          'web/admin/src/App.tsx:36 + Dashboard.tsx:27 — must return ONE jsonb object, not a rowset'),
  ('admin_unmask_phone',       'web/admin/src/screens/Users.tsx:193 rpc(admin_unmask_phone,{target_profile,why})'),
  ('is_admin',                 'schema4 RLS predicate; also called by schema6 tr_read/sp_read'),
  ('admin_role',               'schema4 admins_owner_write predicate'),
  ('admin_at_least',           'schema4 reports/tv/gc/dp admin update predicates'),
  ('owns_trainer',             'schema6 tr_update / sp_write — the trainer panel''s accept/assign writes'),
  ('owns_profile',             'schema6 tr_insert — requestTrainer'),
  ('owns_gym',                 'schema6 profiles_gym_owner_read / checkins_gym_owner_read — the gym roster'),
  ('sync_gym_location',        'schema8 trigger fn — turns owner-picked lat/lng into the PostGIS point gyms_near sorts by'),
  ('handle_new_user',          'schema.sql:134 — auto-creates the profile row on anonymous sign-in'),
  ('create_day_pass',          'schema59 — the ONLY way a day-pass row is created; code and price come from the server'),
  ('check_day_pass',           'schema59 — src/app/gym/pass.tsx «Yoxla»; owner-only, changes nothing, reveals nothing about the visitor'),
  ('redeem_day_pass',          'schema59 — src/app/gym/pass.tsx «Təsdiqlə»; one-way'),
  ('challenge_standings',      'schema60 — src/lib/hooks.ts challengeStandings; the ranking, counted from real workout rows'),
  ('push_text',                'schema61 — the Azerbaijani title/body per notification type. Never carries content.'),
  ('push_send',                'schema61 — pg_net POST to Expo; called only by notify()'),
  ('notify',                   'schema35/49/61 — the single funnel: block check, per-type preference, row, push'),
  ('admin_set_profile_status', 'schema64 — the ONLY way an account is muted/suspended/banned/restored; the three columns stay ungranted so a banned user cannot lift their own ban'),
  ('admin_set_content_hidden', 'schema64 — content takedown for programs/feed_videos/community_posts, audited; programs has an owner UPDATE policy so a column grant is not available'),
  ('admin_match_stats',        'schema65 — web/admin Analytics; counts only, never rows: a match request carries a note one member wrote to another'),
  ('send_match_request',       'schema67 — src/lib/api.ts sendMatchRequest; one row per pair, re-send moves it back to pending'),
  ('register_push_token',      'schema67 — src/lib/push.ts registerPush; moves a token to the phone''s current owner, which push_tokens_own refuses to do from the client'),
  ('require_admin_at_least',   'schema68 — the role-aware gate; require_admin() alone is is_admin() with no minimum'),
  ('admin_verification_note',  'schema68/70 — reads trainer_verifications.internal_note, which has no column grant because the applicant can read their own row')
),

expected_triggers(trg, tbl, why) as (values
  ('gyms_sync_location'::text,'gyms'::text,     'schema8:34 — without it an owner-picked pin never reaches gyms.location and the gym stays invisible to gyms_near'::text),
  ('on_auth_user_created','users',              'schema.sql:145 on auth.users — signInAnonymously (api.ts:47) relies on it to create the profile row')
),

expected_policies(tbl, pol, why) as (values
  -- app read paths
  ('gyms'::text,'gyms_read'::text,                       'schema.sql:84 — public gym list'::text),
  ('profiles','profiles_read',                  'schema.sql:88 — matching needs cross-user read'),
  ('check_ins','check_ins_read',                'schema.sql:100'),
  ('match_requests','match_read',               'schema.sql:109'),
  -- app write paths
  ('profiles','profiles_self_insert',           'schema5:14 — first-time profile upsert (api.ts:71)'),
  ('profiles','profiles_self_update',           'schema5:17 — profile save'),
  -- check_ins has NO insert policy on purpose: schema19 moved check-in behind
  -- the check_in() RPC, which verifies the 150 m radius. A policy here would let
  -- anybody POST «indi zalda» from anywhere in the world.
  ('match_requests','match_insert',             'schema.sql:116 — sendMatchRequest'),
  ('gyms','gyms_insert',                        'schema3:27 — createGym (api.ts:294)'),
  ('gyms','gyms_update',                        'schema3:29 — updateMyGym / lat-lng save'),
  ('trainers','trainers_insert',                'schema3:20 — becomeTrainer upsert (api.ts:262)'),
  ('trainers','trainers_update',                'schema3:22 — the UPDATE half of that upsert + images.ts:68/79'),
  ('programs','programs_insert',                'schema2:165 — workout/create.tsx:165'),
  ('programs','programs_update',                'schema3:35'),
  ('reviews','reviews_insert',                  'schema2:169 — gym/[id].tsx:156'),
  ('reviews','reviews_owner_reply',             'schema7:24 — the owner reply (gymOwner.tsx:237)'),
  ('community_posts','community_posts_insert',  'schema29 — createCommunityPost + gym announcements'),
  ('feed_videos','feed_videos_insert',          'schema29 — uploadFeedVideo'),
  -- day_passes has NO insert policy: schema59 removed dp_user_insert so the code
  -- and the price come from create_day_pass rather than from the visitor''s phone.
  ('day_passes','dp_owner_read',                'schema9 — the gym reads its own passes; check_day_pass depends on it being owner-scoped'),
  ('push_tokens','push_tokens_own',             'schema61 — a device address is readable only by the person it belongs to'),
  ('programs','programs_delete',                'schema68 — without it a programme could be created and never withdrawn, which is why the trainer panel kept its programmes on the device'),
  ('day_passes','dp_user_read',                 'schema4:244'),
  ('reports','reports_insert',                  'schema4:207 — createReport, the one failure users actually see'),
  ('trainer_verifications','tv_insert',         'schema4:226 — verify.tsx:177'),
  ('trainer_verifications','tv_admin_read',     'schema4:228 — also grants the trainer their own row (verify.tsx:71)'),
  ('gym_claims','gc_insert',                    'schema4:235 — submitGymClaim'),
  ('gym_claims','gc_admin_read',                'schema4:237 — also the owner''s own claim (gymOwner.tsx:177)'),
  -- role panels
  ('trainer_requests','tr_insert',              'schema6:66 — requestTrainer'),
  ('trainer_requests','tr_read',                'schema6:70 — getMyStudents'),
  ('trainer_requests','tr_update',              'schema6:75 — accept/decline'),
  ('student_programs','sp_read',                'schema6:80'),
  ('student_programs','sp_write',               'schema6:84 — assignStudentProgram'),
  ('profiles','profiles_gym_owner_read',        'schema6:105 — the gym roster reads OTHER users'' profiles'),
  ('check_ins','checkins_gym_owner_read',       'schema6:109 — the gym occupancy chart'),
  -- user-owned metrics
  ('prs','prs_read',                            'schema2:182'),
  ('prs','prs_write',                           'schema2:184 — logPR'),
  ('workouts','workouts_read',                  'schema2:182'),
  ('workouts','workouts_write',                 'schema2:184 — logWorkout'),
  ('progress','progress_read',                  'schema2:182'),
  ('progress','progress_write',                 'schema2:184 — logWeight'),
  -- admin platform
  ('admins','admins_read',                      'schema4:199 — auth.tsx:34; without it every admin is locked out'),
  ('reports','reports_admin_read',              'schema4:209'),
  ('reports','reports_admin_update',            'schema4:211 — the row lock also needs SELECT-after-UPDATE'),
  ('report_messages','report_msgs_admin_read',  'schema4:216'),
  ('moderation_actions','modact_admin',         'schema4:220'),
  ('trainer_verifications','tv_admin_update',   'schema4:230'),
  ('gym_claims','gc_admin_update',              'schema4:239'),
  ('day_passes','dp_admin_update',              'schema4:246 — refunds'),
  ('audit_log','audit_read',                    'schema4:251'),
  ('audit_log','audit_insert',                  'schema4:253 — audit.ts:18 does NOT check the error; without this every admin action is unlogged and still reports success'),
  ('profiles','profiles_admin_read',            'schema4:265'),
  ('profiles','profiles_admin_update',          'schema4:268 — ban/mute'),
  ('trainers','trainers_admin_update',          'schema4:272 — verification approve'),
  ('gyms','gyms_admin_update',                  'schema4:276 — claim approve')
),

-- storage.objects policies (bucket-scoped), checked by policy name
expected_storage_policies(pol, why) as (values
  ('videos read'::text,   'schema3:42 — getPublicUrl playback'::text),
  ('videos upload', 'schema3:44 — uploadFeedVideo'),
  ('videos update', 'REQUIRED BY upsert:true at src/lib/api.ts:370 (sends x-upsert). schema3 creates read+upload only; schema8 adds an "update" policy for avatars and gyms but nothing ever adds one for videos.'),
  ('avatars read',   'schema8:48'),
  ('avatars upload', 'schema8:50 — src/lib/images.ts:49'),
  ('avatars update', 'schema8:52 — needed because images.ts:49 passes upsert:true'),
  ('gyms read',      'schema8:56'),
  ('gyms upload',    'schema8:58'),
  ('gyms update',    'schema8:60 — upsert:true')
),

-- ---------------------------------------------------------------------------
-- CHECKS
-- ---------------------------------------------------------------------------
results(check_kind, object, status, detail) as (

  -- extensions ------------------------------------------------------------
  select 'extension', 'postgis',
         case when exists (select 1 from pg_extension where extname='postgis') then 'OK' else 'MISSING' end,
         'schema.sql:7 — gyms.location + gyms_near depend on it'

  -- tables ----------------------------------------------------------------
  union all
  select 'table', et.t,
         case when c.relname is null then 'MISSING' else 'OK' end,
         case when c.relname is null then 'no such table in schema public — ' || et.why
              when c.relkind <> 'r' then 'exists but relkind=' || c.relkind::text || ' (expected an ordinary table) — ' || et.why
              when not c.relrowsecurity then 'table present, RLS DISABLED — ' || et.why
              else 'table present, RLS enabled — ' || et.why end
  from expected_tables et
  left join pg_class c
         on c.relname = et.t
        and c.relnamespace = (select oid from pg_namespace where nspname='public')
        and c.relkind in ('r','p','v','m','f')

  -- columns ---------------------------------------------------------------
  union all
  select 'column', ec.t || '.' || ec.c,
         case when col.column_name is null then 'MISSING' else 'OK' end,
         case when col.column_name is null then 'absent — ' || ec.why
              else col.data_type::text
                   || case when col.udt_name::text like '\_%' then ' (' || col.udt_name::text || ')' else '' end
                   || case when col.is_nullable::text='NO' then ' NOT NULL' else '' end
                   || case when col.column_default is not null then ' DEFAULT' else '' end
         end
  from expected_columns ec
  left join information_schema.columns col
         on col.table_schema='public' and col.table_name=ec.t and col.column_name=ec.c

  -- server-side defaults --------------------------------------------------
  union all
  select 'column', ed.t || '.' || ed.c || ' [DEFAULT]',
         case when col.column_name is null or col.column_default is null then 'MISSING' else 'OK' end,
         case when col.column_name is null then 'column absent — ' || ed.why
              when col.column_default is null then 'column present but has NO DEFAULT — ' || ed.why
              else 'default: ' || col.column_default::text end
  from expected_defaults ed
  left join information_schema.columns col
         on col.table_schema='public' and col.table_name=ed.t and col.column_name=ed.c

  -- column types ----------------------------------------------------------
  union all
  select 'type', et.t || '.' || et.c,
         case when col.column_name is null then 'MISSING'
              when col.data_type::text = et.ty then 'OK'
              else 'MISSING' end,
         case when col.column_name is null then 'column absent, cannot check type — ' || et.why
              when col.data_type::text = et.ty then 'is ' || col.data_type::text || ' as required'
              else 'WRONG TYPE: is ' || col.data_type::text || ' (' || col.udt_name::text || '), code requires ' || et.ty || ' — ' || et.why end
  from expected_types et
  left join information_schema.columns col
         on col.table_schema='public' and col.table_name=et.t and col.column_name=et.c

  -- unique indexes behind ON CONFLICT --------------------------------------
  union all
  select 'constraint',
         eu.t || ' UNIQUE(' || array_to_string(eu.cols, ',') || ')',
         case when exists (select 1 from uniq u where u.tbl = eu.t and u.cols = eu.cols)
              then 'OK' else 'MISSING' end,
         case when exists (select 1 from uniq u where u.tbl = eu.t and u.cols = eu.cols)
              then 'unique index present'
              else 'NO unique index on these columns — the upsert raises 42P10 at runtime. ' || eu.why end
  from expected_unique eu

  -- foreign-key targets (the identity model) --------------------------------
  union all
  select 'constraint', efk.t || '.' || efk.c || ' -> ' || efk.target,
         case when exists (select 1 from fks f where f.tbl=efk.t and f.col=efk.c and f.target=efk.target)
              then 'OK' else 'MISSING' end,
         case when exists (select 1 from fks f where f.tbl=efk.t and f.col=efk.c and f.target=efk.target)
              then 'FK points at ' || efk.target || ' as required'
              when exists (select 1 from fks f where f.tbl=efk.t and f.col=efk.c)
              then 'WRONG TARGET: FK points at '
                   || (select string_agg(distinct f.target, ', ') from fks f where f.tbl=efk.t and f.col=efk.c)
                   || ', code requires ' || efk.target || ' — ' || efk.why
              else 'no FK on this column (values are unvalidated) — ' || efk.why end
  from expected_fk efk

  -- CHECK constraints must permit the literals the code writes ---------------
  union all
  select 'constraint', el.t || '.' || el.c || ' accepts ''' || el.lit || '''',
         case when ch.defs is null then 'OK'
              when ch.defs not like '%' || el.c || '%' then 'OK'
              when ch.defs like '%''' || el.lit || '''%' then 'OK'
              else 'MISSING' end,
         case when ch.defs is null then 'no CHECK constraints on this table — value is unconstrained'
              when ch.defs not like '%' || el.c || '%' then 'no CHECK constraint mentions this column — value is unconstrained'
              when ch.defs like '%''' || el.lit || '''%' then 'CHECK permits it'
              else 'CHECK constraint on ' || el.t || ' does NOT list ''' || el.lit || ''' — the write is rejected. ' || el.why end
  from expected_literal el
  left join checks ch on ch.tbl = el.t

  -- storage buckets ---------------------------------------------------------
  union all
  select 'bucket', eb.b,
         case when b.id is null then 'MISSING'
              when coalesce(b.public,false) = false then 'MISSING'
              else 'OK' end,
         case when b.id is null then 'bucket does not exist — ' || eb.why
              when coalesce(b.public,false) = false
                then 'bucket exists but public = false; getPublicUrl() does not sign anything, so every image/video 404s — ' || eb.why
              else 'public bucket — ' || eb.why end
  from expected_buckets eb
  left join storage.buckets b on b.id = eb.b

  -- functions / RPCs --------------------------------------------------------
  union all
  select 'rpc', er.f,
         case when p.proname is null then 'MISSING' else 'OK' end,
         case when p.proname is null then 'function not found in schema public — ' || er.why
              else 'present: ' || pg_get_function_identity_arguments(p.oid)
                   || ' returns ' || pg_catalog.format_type(p.prorettype, null::integer) end
  from expected_rpcs er
  left join lateral (
    select pr.oid, pr.proname, pr.prorettype
    from pg_proc pr
    join pg_namespace pn on pn.oid = pr.pronamespace and pn.nspname='public'
    where pr.proname = er.f
    order by pr.oid
    limit 1
  ) p on true

  -- triggers ---------------------------------------------------------------
  union all
  select 'trigger', et.trg || ' on ' || et.tbl,
         case when exists (
                select 1 from pg_trigger tg
                join pg_class cl on cl.oid = tg.tgrelid
                where tg.tgname = et.trg and cl.relname = et.tbl and not tg.tgisinternal)
              then 'OK' else 'MISSING' end,
         et.why
  from expected_triggers et

  -- RLS policies on public tables -------------------------------------------
  union all
  select 'policy', ep.tbl || '.' || ep.pol,
         case when pp.policyname is null then 'MISSING' else 'OK' end,
         case when pp.policyname is null then 'policy absent — ' || ep.why
              else pp.cmd || ' policy present — ' || ep.why end
  from expected_policies ep
  left join pg_policies pp
         on pp.schemaname='public' and pp.tablename=ep.tbl and pp.policyname=ep.pol

  -- RLS policies on storage.objects -----------------------------------------
  union all
  select 'policy', 'storage.objects."' || esp.pol || '"',
         case when pp.policyname is null then 'MISSING' else 'OK' end,
         case when pp.policyname is null then 'policy absent — ' || esp.why
              else pp.cmd || ' policy present — ' || esp.why end
  from expected_storage_policies esp
  left join pg_policies pp
         on pp.schemaname='storage' and pp.tablename='objects' and pp.policyname=esp.pol

  -- tables that have RLS on but NO write policy the code needs ---------------
  -- (challenges is created + toggled by the admin panel, and errors there are
  --  swallowed, so this is invisible in the UI)
  union all
  select 'policy', 'challenges INSERT (any policy)',
         case when exists (select 1 from pg_policies
                           where schemaname='public' and tablename='challenges'
                             and cmd in ('INSERT','ALL'))
              then 'OK' else 'MISSING' end,
         'web/admin/src/screens/Challenges.tsx:137-149 inserts a challenge. schema2:146 turns RLS ON for challenges but only ever creates challenges_read (SELECT). No migration adds an INSERT policy.'
  union all
  select 'policy', 'challenges UPDATE (any policy)',
         case when exists (select 1 from pg_policies
                           where schemaname='public' and tablename='challenges'
                             and cmd in ('UPDATE','ALL'))
              then 'OK' else 'MISSING' end,
         'web/admin/src/screens/Challenges.tsx:114 toggles challenges.active. Same gap: RLS on, SELECT-only policy set.'
  union all
  select 'policy', 'day_passes SELECT for the gym owner',
         case when exists (select 1 from pg_policies
                           where schemaname='public' and tablename='day_passes'
                             and cmd in ('SELECT','ALL')
                             and coalesce(qual,'') like '%owns_gym%')
              then 'OK' else 'MISSING' end,
         'src/lib/roles.ts:244 getGymDayPasses reads day_passes by gym_id for the gym-owner revenue card (src/app/gym/index.tsx:61,236). The only SELECT policy is schema4:244 dp_user_read = (auth.uid() = user_id or is_admin). An owner is neither, so the query returns [] and the card reads 0 forever. schema6 added owns_gym() read policies for profiles and check_ins but never one for day_passes.'
)

select check_kind, object, status, detail
from results
order by (status = 'MISSING') desc, check_kind, object;


-- ============================================================================
-- OPTIONAL DATA PROBES — run these SEPARATELY, after the query above reports
-- the relevant tables as OK. They are left commented out on purpose: Postgres
-- plans a statement in full before executing it, so a direct reference to a
-- table that does not exist would make the whole diagnostic ERROR instead of
-- reporting MISSING — which is exactly what this file must never do.
--
-- These are data facts the client hard-codes, not schema:
--
--   -- src/lib/hooks.ts:250 picks the active challenge by this literal id.
--   -- With no such row, an arbitrary row silently becomes the "active" one.
--   select 'aug-12 present' as probe, exists (select 1 from public.challenges where id = 'aug-12') as ok;
--
--   -- src/lib/hooks.ts:270 marks the user's own gym by this literal id.
--   select 'iron-bay present' as probe, exists (select 1 from public.gyms where id = 'iron-bay') as ok;
--
--   -- src/lib/roles.ts:45 finds a trainer by owner_id, while
--   -- src/app/trainer/verify.tsx:79 and src/lib/images.ts:68 look the SAME
--   -- trainer up by id. Both resolve one row only when id = owner_id, which is
--   -- what src/app/(tabs)/profile/become-trainer.tsx:42 writes. Trainers seeded
--   -- with a slug id (schema2.sql:192, 'elvin-m') never match, so the panel
--   -- cannot reach them. Any row listed here is unreachable from the app:
--   select id, owner_id from public.trainers
--    where owner_id is not null and id <> owner_id::text;
-- ============================================================================
