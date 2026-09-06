-- Hərəkət kitabxanası: tətbiqdəki hərəkətlər bazaya.
-- video_url boş qalır — video əlavə etmək artıq bir UPDATE, kod buraxılışı yox.
insert into public.exercises (id, name, muscle, sets, reps, common_mistake)
values
  ('squat', 'Ştanqla skvat', 'Ayaq', 4, '5–6', 'Dizləri içəri buraxmaq. Dizlər ayaq barmağı istiqamətində qalmalıdır.'),
  ('bench', 'Ştanqla bench press', 'Sinə', 4, '6–8', 'Dirsəkləri 90° açmaq — çiyinə yük düşür. ~45° saxla.'),
  ('deadlift', 'Deadlift', 'Kürək', 3, '3–5', 'Beli əymək. Neytral onurğa, ştanq bədənə yaxın.'),
  ('ohp', 'Ştanqla çiyin press', 'Çiyin', 3, '6–8', 'Beli aşırı əymək. Qarını sıx, gluteus aktiv.'),
  ('row', 'Ştanqla dartma (row)', 'Kürək', 4, '8–10', 'Gövdəni yelləmək — impuls ilə çəkmək. Nəzarətli çək.'),
  ('pullup', 'Dartılma (pull-up)', 'Kürək', 3, '6–10', 'Tam açmamaq. Aşağıda qollar tam uzanmalı.'),
  ('lat', 'Lat pulldown', 'Kürək', 3, '10–12', 'Arxaya çox əyilmək. Gövdə demək olar sabit.'),
  ('incline', 'Maili dumbbell press', 'Sinə', 3, '8–10', 'Dirsəkləri kilidləyib dincəltmək. Gərginliyi saxla.'),
  ('legpress', 'Leg press', 'Ayaq', 3, '10–12', 'Dizləri sinəyə həddən çox yaxınlaşdırmaq — bel qalxır.'),
  ('rdl', 'Romanian deadlift', 'Arxa ayaq', 3, '8–10', 'Dizləri çox bükmək — skvata çevrilir. Hip hinge saxla.'),
  ('curl', 'Dumbbell biseps curl', 'Biseps', 3, '10–12', 'Gövdəni yelləmək. Dirsək sabit qalsın.'),
  ('pushdown', 'Triseps pushdown', 'Triseps', 3, '10–12', 'Dirsəyi bədəndən aralamaq.'),
  ('dips', 'Paralel dips', 'Triseps', 3, '8–12', 'Çox aşağı enmək — çiyini incidir.'),
  ('lateral', 'Yan qaldırma (lateral raise)', 'Çiyin', 3, '12–15', 'Trapesi ilə qaldırmaq. Çiyindən yönləndir.'),
  ('legcurl', 'Leg curl', 'Arxa ayaq', 3, '10–12', 'Kalçanı qaldırmaq. Pelvis sabit.'),
  ('calf', 'Baldır qaldırma (calf raise)', 'Baldır', 4, '12–15', 'Yarım amplituda. Tam uzat və qaldır.'),
  ('plank', 'Plank', 'Qarın', 3, '45 san', 'Kalçanı qaldırmaq və ya sallamaq. Bədən düz xətt.'),
  ('hip', 'Hip thrust', 'Gluteus', 3, '8–12', 'Beli aşırı əymək. Qabırğanı aşağı saxla.')
on conflict (id) do update set
  name = excluded.name,
  muscle = excluded.muscle,
  sets = excluded.sets,
  reps = excluded.reps,
  common_mistake = excluded.common_mistake;

select count(*) hamisi, count(video_url) videolu from public.exercises;
