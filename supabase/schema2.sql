-- =====================================================================
-- SPOT — full app schema (part 2): trainers, programs, workouts, nutrition,
-- feed, community, challenges, chat, reviews, PRs, progress.
-- Run AFTER schema.sql, in Supabase → SQL Editor. Idempotent + seeded.
-- =====================================================================

-- gyms: add a "tons lifted" metric for the cross-gym leaderboard
alter table public.gyms add column if not exists tons numeric default 0;
update public.gyms set tons = 68 where id='iron-bay' and coalesce(tons,0)=0;
update public.gyms set tons = 74 where id='volt-gym' and coalesce(tons,0)=0;
update public.gyms set tons = 41 where id='atlas-fit' and coalesce(tons,0)=0;
update public.gyms set tons = 22 where id='peak-house' and coalesce(tons,0)=0;

-- ---------------------------------------------------------------------
create table if not exists public.trainers (
  id text primary key,
  name text not null,
  verified boolean default false,
  gym_id text references public.gyms(id),
  specialty text,
  rating numeric(2,1) default 0,
  clients int default 0,
  response_time text,
  price_from int default 0,
  bio text,
  certifications text[] default '{}'
);

create table if not exists public.exercises (
  id text primary key,
  name text not null,
  muscle text,
  sets int default 3,
  reps text,
  common_mistake text,
  substitutes text[] default '{}',
  video_url text
);

create table if not exists public.programs (
  id text primary key,
  title text not null,
  creator_name text,
  creator_type text,           -- trainer | user
  creator_verified boolean default false,
  weeks int, days_per_week int,
  level text, goal text,
  paid boolean default false, price int,
  rating numeric(2,1) default 0,
  minutes int, video_count int, done_by int,
  has_meal_plan boolean default false,
  tags text[] default '{}',
  saves int default 0,
  days jsonb default '[]'       -- [{title, focus, exercise_ids[]}]
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  gym_id text references public.gyms(id) on delete cascade,
  name text, tenure text, rating int, body text,
  created_at timestamptz default now()
);

create table if not exists public.challenges (
  id text primary key,
  title text, scope text, scope_label text, description text,
  target int, unit text, days_left int, reward text,
  participants int default 0, active boolean default false,
  progress int default 0,
  leaderboard jsonb default '[]',
  day_cells jsonb default '[]'
);

create table if not exists public.feed_videos (
  id text primary key,
  author text, verified boolean default false, is_trainer boolean default false,
  caption text, hashtags text[] default '{}',
  likes int default 0, comments int default 0,
  linked_program_title text, linked_program_id text,
  video_url text, gradient text[] default '{}',
  ord int default 0
);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author text, gym text, time_ago text, type text, body text,
  stats jsonb, likes int default 0, comments int default 0,
  trainer_comment jsonb,
  created_at timestamptz default now()
);

create table if not exists public.chats (
  id text primary key,
  name text, type text, verified boolean default false, online boolean default false,
  last text, time text, unread boolean default false, faded boolean default false,
  ord int default 0
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id text references public.chats(id) on delete cascade,
  from_me boolean default false, body text,
  created_at timestamptz default now()
);

-- user-specific
create table if not exists public.prs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  lift text, value numeric, delta text,
  created_at timestamptz default now()
);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  program_id text, title text,
  duration_sec int, volume_kg numeric, sets_done int, rpe text,
  created_at timestamptz default now()
);

create table if not exists public.progress (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  weight numeric,
  created_at timestamptz default now()
);

-- meals: shared daily plan (reference)
create table if not exists public.meals (
  id text primary key,
  name text, slot text, kcal int, protein int, carb int, fat int,
  post_workout boolean default false, ingredients text[] default '{}', ord int default 0
);

create table if not exists public.shop_items (
  id text primary key, name text, qty text, price numeric, ord int default 0
);

-- =====================================================================
-- RLS
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['trainers','exercises','programs','reviews','challenges','feed_videos','community_posts','chats','messages','prs','workouts','progress','meals','shop_items']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- public read for content tables
do $$
declare t text;
begin
  foreach t in array array['trainers','exercises','programs','reviews','challenges','feed_videos','community_posts','chats','messages','meals','shop_items']
  loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (true)', t, t);
  end loop;
end $$;

-- authenticated can create content (programs, posts, reviews, messages, feed comments)
drop policy if exists programs_insert on public.programs;
create policy programs_insert on public.programs for insert to authenticated with check (true);
drop policy if exists posts_insert on public.community_posts;
create policy posts_insert on public.community_posts for insert to authenticated with check (true);
drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews for insert to authenticated with check (true);
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check (true);
drop policy if exists feedvideos_insert on public.feed_videos;
create policy feedvideos_insert on public.feed_videos for insert to authenticated with check (true);

-- user-owned tables (prs, workouts, progress)
do $$
declare t text;
begin
  foreach t in array array['prs','workouts','progress']
  loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format($f$create policy %I_read on public.%I for select to authenticated using (profile_id in (select id from public.profiles where user_id = auth.uid()))$f$, t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format($f$create policy %I_write on public.%I for all to authenticated using (profile_id in (select id from public.profiles where user_id = auth.uid())) with check (profile_id in (select id from public.profiles where user_id = auth.uid()))$f$, t, t);
  end loop;
end $$;

-- =====================================================================
-- SEED
-- =====================================================================
insert into public.trainers (id,name,verified,gym_id,specialty,rating,clients,response_time,price_from,bio,certifications) values
 ('elvin-m','Elvin Məmmədov',true,'iron-bay','Güc & hipertrofiya',4.9,38,'2 saat',30,'10 illik təcrübə. Powerlifting və kütlə yığma üzrə ixtisaslaşıb.','{"NASM sertifikatı","Powerlifting hakimi","Iron Bay təsdiqi"}'),
 ('nigar-a','Nigar Əliyeva',true,'iron-bay','Arıqlama & funksional',4.8,44,'1 saat',28,'Funksional məşq və çəki idarəetməsi üzrə mütəxəssis.','{"ACE sertifikatı","Qida məsləhətçisi","Iron Bay təsdiqi"}'),
 ('rauf-q','Rauf Quliyev',false,'iron-bay','Bodybuilding',4.5,12,'5 saat',25,'Yarış təcrübəsi olan bodybuilder.','{"Öz təcrübəsi"}')
on conflict (id) do nothing;

insert into public.exercises (id,name,muscle,sets,reps,common_mistake,substitutes) values
 ('bench','Ştanqla bench press','Sinə',4,'6–8','Dirsəkləri həddən artıq açmaq — çiyinə yük düşür.','{"Dumbbell press","Maşında press"}'),
 ('ohp','Çiyin press','Çiyin',3,'8–10','Beli aşırı əymək.','{"Dumbbell çiyin press"}'),
 ('dips','Paralel dips','Triseps',3,'10–12','Çox aşağı enmək — çiyini incidir.','{"Triseps pushdown"}')
on conflict (id) do nothing;

insert into public.programs (id,title,creator_name,creator_type,creator_verified,weeks,days_per_week,level,goal,paid,price,rating,minutes,video_count,done_by,has_meal_plan,tags,saves,days) values
 ('ppl-strength','Push Pull Legs — Güc','Elvin Məmmədov','trainer',true,8,6,'Orta','Güc',false,null,4.9,55,28,1240,false,'{"Sərbəst ağırlıq","Güc","Zal"}',1240,'[{"title":"Gün 1 · Push","focus":"Sinə, çiyin, triseps","exercise_ids":["bench","ohp","dips"]},{"title":"Gün 2 · Pull","focus":"Kürək, biseps","exercise_ids":[]},{"title":"Gün 3 · Legs","focus":"Ayaq, gluteus","exercise_ids":[]}]'),
 ('home-basics','Evdə başlanğıc — avadanlıqsız','Rəşad (istifadəçi)','user',false,4,3,'Başlanğıc','Forma saxlamaq',false,null,4.6,20,12,380,false,'{"Evdə","Avadanlıqsız","Bodyweight"}',430,'[{"title":"Gün 1 · Tam bədən","focus":"Bütün əzələ qrupları","exercise_ids":[]}]'),
 ('fat-loss-8','8 həftəlik arıqlama','Nigar Əliyeva','trainer',true,8,4,'Başlanğıc','Arıqlamaq',false,null,4.7,45,16,890,true,'{"Funksional","Kardio","Arıqlama"}',890,'[{"title":"Gün 1 · HIIT","focus":"Yüksək intensivlik","exercise_ids":[]}]'),
 ('strength-5x5','Güc bazası — 5x5','Rəşad M.','user',true,12,3,'Orta','Güc',true,15,4.8,50,15,210,false,'{"Sərbəst ağırlıq","Güc","5x5"}',210,'[{"title":"Gün A","focus":"Skvat, bench, dartma","exercise_ids":["bench"]}]')
on conflict (id) do nothing;

insert into public.reviews (gym_id,name,tenure,rating,body) values
 ('iron-bay','Elçin','8 aydır check-in edir',5,'Avadanlıq təzədir, personal çox köməkçidir. Səhər izdiham az olur.'),
 ('iron-bay','Günel','3 aydır check-in edir',4,'Duşlar təmiz, park var. Axşam saatlarında biraz sıxlıq olur.')
on conflict do nothing;

insert into public.challenges (id,title,scope,scope_label,description,target,unit,days_left,reward,participants,active,progress,leaderboard,day_cells) values
 ('aug-12','Avqust · 12 məşq','gym','Iron Bay · komanda','Avqust ayında 12 məşq tamamla. Zal üzvlüyü qazanma şansı.',12,'məşq',11,'1 aylıq üzvlük',84,true,8,
   '[{"rank":1,"name":"Tural M.","value":"12 məşq"},{"rank":2,"name":"Kamran","value":"11 məşq"},{"rank":3,"name":"Nigar Ə.","value":"10 məşq"},{"rank":7,"name":"Sən","value":"8 məşq","me":true,"delta":"+2 yer"},{"rank":8,"name":"Orxan","value":"8 məşq"}]',
   '[true,true,false,true,true,false,false]'),
 ('cross-100t','Zallar arası: 100 ton','gym','Komanda','Zalın ümumi qaldırdığı çəki 100 tona çatsın. Üzv başına normalizasiya ilə.',100,'t',20,'Zal reytinqində 1-ci yer',214,false,68,'[]','[]'),
 ('first-5-pullups','İlk 5 dartma','solo','Yeni başlayanlar · 4 həftə','4 həftədə ilk 5 təmiz dartmaya çat.',5,'dartma',28,'Nişan + proqram',340,false,2,'[]','[]')
on conflict (id) do nothing;

insert into public.feed_videos (id,author,verified,is_trainer,caption,hashtags,likes,comments,linked_program_title,linked_program_id,gradient,video_url,ord) values
 ('v1','Elvin M.',true,true,'Ölü qaldırmada bel yuvarlanırsa, çəkini azalt və bunu et. 3 addım, 20 saniyə.','{"#texnika","#ölüqaldırma"}',2418,184,'Ölü qaldırma · PPL proqramı','ppl-strength','{"#3A3A44","#101014"}','https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4',1),
 ('v2','Aysel',false,false,'30 gün funksional challenge — 12-ci gün. Enerji yerindədir!','{"#challenge","#funksional"}',940,56,'8 həftəlik arıqlama','fat-loss-8','{"#2E3A34","#111417"}','https://media.w3.org/2010/05/sintel/trailer.mp4',2),
 ('v3','Nigar Əliyeva',true,true,'Evdə core üçün 4 hərəkət — avadanlıq lazım deyil.','{"#evdə","#core"}',1310,92,'Evdə başlanğıc','home-basics','{"#3A3440","#141014"}','https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_1MB.mp4',3)
on conflict (id) do nothing;
update public.feed_videos set video_url = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4' where id='v1' and video_url is null;
update public.feed_videos set video_url = 'https://media.w3.org/2010/05/sintel/trailer.mp4' where id='v2' and video_url is null;
update public.feed_videos set video_url = 'https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_1MB.mp4' where id='v3' and video_url is null;

insert into public.community_posts (author,gym,time_ago,type,body,stats,likes,comments,trainer_comment) values
 ('Kamran','Iron Bay','2 saat','progress','3 ayın nəticəsi. Ardıcıllıq hər şeydir.','[{"label":"çəki","value":"-6 kq"},{"label":"müddət","value":"3 ay"},{"label":"məşq","value":"46"}]',128,24,'{"name":"Elvin M.","text":"Bench forması çox yaxşılaşıb. Növbəti mərhələ üçün proqramı yenilə."}'),
 ('Tural','Iron Bay','5 saat','text','Bu gün 180 kq skvat! Iron Bay-də səhər komandası kömək etdi 🙌',null,92,15,null)
on conflict do nothing;

insert into public.chats (id,name,type,verified,online,last,time,unread,faded,ord) values
 ('tural','Tural M.','partner',false,true,'Bugün 19:00-da ölü qaldırma günüdür, spot lazım…','14:22',true,false,1),
 ('elvin','Elvin Qasımov','trainer',true,false,'Çərşənbə 18:00 təsdiqləndi. Videonu göndər…','Dünən',false,false,2),
 ('gym-challenge','Iron Bay · Avqust challenge','gym',false,false,'Kamran: 12-ni bağladım, sizi gözləyirəm 💪','Dünən',false,false,3),
 ('sebine','Səbinə Q.','partner',false,false,'Sən: Zalın səhər saatları boş olur, rahat…','3 gün',false,true,4)
on conflict (id) do nothing;

insert into public.messages (chat_id,from_me,body)
select 'tural', v.fm, v.b from (values (false,'Salam! Sabah axşam 19:00-da gələcəm.'),(true,'Əla, mən də o vaxt olacam. Push günüdür.'),(false,'Bugün 19:00-da ölü qaldırma günüdür, spot lazımdır. Varsan?')) as v(fm,b)
where not exists (select 1 from public.messages where chat_id='tural');

insert into public.meals (id,name,slot,kcal,protein,carb,fat,post_workout,ingredients,ord) values
 ('m1','Yulaf, banan və qoz','Səhər · 8:00',420,18,62,12,false,'{"Yulaf 80 q","Banan 1 ədəd","Qoz 20 q","Süd 200 ml"}',1),
 ('m2','Toyuq döşü, düyü və salat','Nahar · 13:00',650,52,70,14,false,'{"Toyuq döşü 200 q","Düyü 100 q","Tərəvəz salatı","Zeytun yağı 1 x.q."}',2),
 ('m3','Protein şeyk və banan','Məşqdən sonra · 18:30',320,34,40,4,true,'{"Zülal tozu 30 q","Banan 1 ədəd","Su 300 ml"}',3),
 ('m4','Balıq, kartof və tərəvəz','Axşam · 20:30',560,42,48,20,false,'{"Qızılbalıq 180 q","Kartof 200 q","Brokoli 150 q"}',4)
on conflict (id) do nothing;

insert into public.shop_items (id,name,qty,price,ord) values
 ('s1','Toyuq döşü','1 kq',8,1),('s2','Qızılbalıq','400 q',12,2),('s3','Yulaf','500 q',3,3),
 ('s4','Düyü','1 kq',4,4),('s5','Banan','1 kq',2.5,5),('s6','Tərəvəz (salat üçün)','—',6,6),('s7','Zülal tozu','1 kq',35,7)
on conflict (id) do nothing;

-- refresh seed check-ins with a long expiry so the demo stays "live" (indi zalda N nəfər)
delete from public.check_ins
where profile_id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333')
  and gym_id = 'iron-bay';
insert into public.check_ins (profile_id, gym_id, expires_at)
select id, 'iron-bay', now() + interval '30 days'
from public.profiles
where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333');
