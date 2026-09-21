import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CreatorBadge } from '@/components/CreatorBadge';
import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Tag } from '@/components/ui/Tag';
import { useProgram, useProgramPhase } from '@/lib/hooks';
import { hasSupabaseConfig } from '@/lib/supabase';
import { removeProgram } from '@/lib/removeProgram';
import { useT } from '@/lib/useT';
import { seedById, useAllPrograms, useDb } from '@/store/db';
import { actionSheet, confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';
import { estimateDurationMin, resolveDayExercises } from '../day';

export default function ProgramDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const remote = useProgram(id);
  const all = useAllPrograms();
  const saved = useDb((s) => s.savedPrograms);
  const matches = useDb((s) => s.matches);
  const toggleSaved = useDb((s) => s.toggleSavedProgram);
  const mine = useDb((s) => s.myPrograms.some((p) => p.id === id));
  const workouts = useDb((s) => s.workouts);

  const p = all.find((x) => x.id === id) ?? remote;

  /* The phase comes from the hook now, not from a second request. `useProgram`
     sits on `useFocusFetch`, which records loading/ready/failed under the same
     key — so «Yüklənir…», «Proqram yüklənmədi» and «Proqram tapılmadı» stay
     three different sentences without this screen paying for a duplicate round
     trip on every open. */
  const fetchPhase = useProgramPhase(id);
  const probe: 'pending' | 'missing' | 'failed' =
    fetchPhase === 'failed'
      ? 'failed'
      : fetchPhase === 'ready'
        ? 'missing'
        : // 'loading', and also 'idle': the focus effect has not run yet on the
          // very first render. Reading idle as «missing» would flash «Proqram
          // tapılmadı» before anything had even been asked for. Without a server
          // configured nothing ever will be asked, and then missing is the truth.
          hasSupabaseConfig
          ? 'pending'
          : 'missing';

  if (!p) {
    /* A `mine-…` id is a program written on somebody's phone. It reaches the
       server now (lib/saveProgram.ts), so this is no longer the ordinary case —
       but it is still what an id looks like when the author's save fell back to
       'local', and then the assigned program genuinely is on their device
       alone. Saying «silinib» about it would blame the wrong thing. */
    const trainerLocal = typeof id === 'string' && id.startsWith('mine-');
    const heading =
      probe === 'pending' ? t('Yüklənir…') : probe === 'failed' ? t('Proqram yüklənmədi') : t('Proqram tapılmadı');
    const detail =
      probe === 'pending'
        ? null
        : probe === 'failed'
          ? t('Bağlantı ilə problem oldu. İnternetini yoxla, geri qayıdıb yenidən aç.')
          : trainerLocal
            ? t('Bu proqram serverə yüklənməyib — məzmunu yalnız onu yazan adamın cihazındadır. Ondan yenidən yadda saxlamasını xahiş et.')
            : t('Bu proqram silinib və ya ünvan səhvdir.');
    return (
      <View style={{ flex: 1, backgroundColor: palette.grouped }}>
        <NavBar />
        <View style={styles.missing}>
          <Icon
            name={probe === 'failed' ? 'x' : 'dumbbell'}
            size={30}
            color={probe === 'failed' ? '#FF9500' : palette.tertiary}
          />
          <AppText variant="headline" style={{ marginTop: 12 }}>
            {heading}
          </AppText>
          {detail ? (
            <AppText
              variant="body"
              color={palette.textSecondary}
              center
              style={{ marginTop: 6, maxWidth: 280, lineHeight: 21 }}>
              {detail}
            </AppText>
          ) : null}
          <Button
            title={t('Geri')}
            variant="secondary"
            onPress={() => router.back()}
            style={{ marginTop: 18, height: 44, paddingHorizontal: 26 }}
          />
        </View>
      </View>
    );
  }

  const days = p.days ?? [];
  const hasDays = days.length > 0;
  const isSaved = saved.includes(p.id);
  const desc = p.desc?.trim();

  /* The NEXT day, not day 1. It always sent dayIndex 0, so somebody on Day 3 of
     a coach's plan who opened the program and tapped «Başla» redid Day 1 —
     and logged it against the program, which pushed the Məşq tab's «next day»
     count out of step as well. Same rule the Məşq tab uses: sessions logged
     against this program, modulo its days. */
  const nextDay = days.length ? workouts.filter((w) => w.programId === p.id).length % days.length : 0;
  const start = (partnerId?: string) => {
    if (!hasDays) return;
    if (!isSaved) toggleSaved(p.id); // following this program from now on
    router.push({
      pathname: '/(tabs)/workout/session',
      params: {
        programId: p.id,
        dayIndex: String(nextDay),
        title: days[nextDay]?.title ?? p.title,
        ...(partnerId ? { partnerId } : {}),
      },
    });
  };

  const startWithPartner = () => {
    const accepted = Object.values(matches).filter((m) => m.state === 'accepted');
    if (!accepted.length) {
      confirm(t('Hələ yoldaşın yoxdur'), t('Birlikdə məşq etmək üçün əvvəlcə yoldaş tap — eyni zalda, eyni cədvəldə.'), [
        { label: t('İndi yox'), style: 'cancel' },
        { label: t('Yoldaş tap'), style: 'primary', onPress: () => router.push('/(tabs)/discover') },
      ]);
      return;
    }
    actionSheet({
      title: t('Kiminlə məşq edirsən?'),
      actions: [
        ...accepted.map((m) => ({
          label: seedById(m.partnerId)?.name ?? m.partnerId,
          onPress: () => start(m.partnerId),
        })),
        { label: t('Bağla'), style: 'cancel' as const },
      ],
    });
  };

  const manage = () =>
    actionSheet({
      title: p.title,
      actions: [
        /* Was «Hərəkət əlavə et», which opened the exercise LIBRARY — a
           browsing screen that adds nothing to any program. Tapping it from
           your own program looked like an edit and changed nothing. Real
           editing goes to the builder that wrote the program, with the
           program loaded into it. */
        {
          label: t('Redaktə et'),
          onPress: () => router.push({ pathname: '/(tabs)/workout/create', params: { id: p.id } }),
        },
        {
          label: t('Proqramı sil'),
          style: 'destructive' as const,
          onPress: () =>
            setTimeout(
              () =>
                confirm(t('Proqram silinsin?'), t('Geri qaytarmaq olmaz.'), [
                  { label: t('Ləğv et'), style: 'cancel' },
                  {
                    label: t('Sil'),
                    style: 'destructive',
                    onPress: () => {
                      void (async () => {
                        const r = await removeProgram(p.id);
                        if (!r.ok) {
                          // It is still published, under this author's name. Saying
                          // «silindi» and letting the library serve it again a minute
                          // later is what this whole path was.
                          toast(t('Proqram silinmədi — serverə çatmadı. Bağlantını yoxla.'), 'error');
                          return;
                        }
                        toast(t('Proqram silindi'));
                        router.back();
                      })();
                    },
                  },
                ]),
              250
            ),
        },
        { label: t('Bağla'), style: 'cancel' as const },
      ],
    });

  return (
    <View style={{ flex: 1, backgroundColor: palette.grouped }}>
      <NavBar
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            {mine ? (
              <PressableScale activeScale={0.9} onPress={manage}>
                <Icon name="more" size={20} color={palette.inkText} />
              </PressableScale>
            ) : null}
            <PressableScale
              activeScale={0.9}
              onPress={() => {
                toggleSaved(p.id);
                toast(isSaved ? t('Yadda saxlanılanlardan çıxarıldı') : t('Proqram yadda saxlanıldı'));
              }}>
              <Icon name="bookmark" size={20} color={isSaved ? palette.voltDeep : palette.inkText} />
            </PressableScale>
          </View>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={{ paddingHorizontal: spacing.screen }}>
          {/* No image slot: a Program carries no cover, so the grey "video" block
              that used to sit here only announced that something was missing. */}
          <AppText variant="title" style={{ marginTop: 4 }}>
            {t(p.title)}
          </AppText>

          {desc ? (
            <AppText variant="body" color={palette.textSecondary} style={{ marginTop: 8, lineHeight: 21 }}>
              {desc}
            </AppText>
          ) : null}

          {/* Creator block — never hidden */}
          <View style={styles.creatorCard}>
            <CreatorBadge name={p.creatorName} type={p.creatorType} verified={p.creatorVerified} avatarSize={28} />
          </View>

          {/* A price is information about what the author charges OUTSIDE the app.
              Without saying so, the badge on the card reads as something to buy —
              and SPOT never takes a payment. */}
          {p.paid && p.price ? (
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 10, lineHeight: 17 }}>
              {t('{price} ₼ — müəllifin öz qiymətidir və yalnız məlumat üçündür. SPOT ödəniş qəbul etmir; proqram tətbiqdə pulsuz açılır.', { price: p.price })}
            </AppText>
          ) : null}

          <View style={styles.metaChips}>
            {/* A tag per fact the program actually carries. SPOT's own starter
                plans describe their length, level and goal; a program somebody
                wrote in the app is a name and a list of days, and nothing here
                invents the rest for them. */}
            {p.weeks > 0 ? <Tag label={t('{n} həftə', { n: p.weeks, count: p.weeks })} /> : null}
            {days.length || p.daysPerWeek ? (
              <Tag label={t('{n} gün', { n: days.length || p.daysPerWeek, count: days.length || p.daysPerWeek })} />
            ) : null}
            {p.minutes > 0 ? <Tag label={t('{n} dəq', { n: p.minutes, count: p.minutes })} /> : null}
            {p.level ? <Tag label={t(p.level)} /> : null}
            {p.goal ? <Tag label={t(p.goal)} /> : null}
            {/* No «Qida planı daxil» tag. Nothing in SPOT attaches meals to a
                program: `useMeals()` returns ONE global list, and the Qida screen
                labels it «Nümunə yeməklər — Hamı üçün eyni nümunə gün» while
                saying outright that it knows nothing about this person's weight,
                goal or calorie target. There is no route from a program to any
                meal content at all, so the badge sent whoever picked
                «8 həftəlik arıqlama» for its promised plan looking for something
                that was never there. It comes back when a program can really
                carry meals. */}
          </View>

          {p.rating > 0 || p.doneBy > 0 ? (
            <View style={styles.statBar}>
              {p.rating > 0 ? (
                <>
                  <View style={styles.statItem}>
                    <Icon name="star" size={14} color={palette.streak} />
                    <AppText variant="headline">{p.rating}</AppText>
                  </View>
                  <View style={styles.vsep} />
                </>
              ) : null}
              {/* Zero videos exist in the app today — «0 video» would advertise
                  content that is not there. Show the figure only when it is real. */}
              {p.videoCount > 0 ? (
                <AppText variant="subhead" color={palette.textSecondary}>
                  {t('{n} video', { n: p.videoCount, count: p.videoCount })}
                </AppText>
              ) : null}
              {p.doneBy > 0 ? (
                <>
                  <View style={styles.vsep} />
                  <AppText variant="subhead" color={palette.textSecondary}>
                    {t('{n} nəfər edir', { n: p.doneBy, count: p.doneBy })}
                  </AppText>
                </>
              ) : null}
            </View>
          ) : (
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 14 }}>
              {t('Yeni proqram — hələ rəy yoxdur.')}
            </AppText>
          )}

          <AppText variant="overline" color={palette.caption} style={{ marginTop: 24, marginBottom: 12 }}>
            {t('Proqram günləri')}
          </AppText>
          {hasDays ? (
            days.map((day, i) => {
              const exs = resolveDayExercises(p, i, day.title);
              return (
                <PressableScale
                  key={i}
                  activeScale={0.98}
                  onPress={() => router.push({ pathname: '/(tabs)/workout/day', params: { programId: p.id, dayIndex: String(i), title: day.title, focus: day.focus } })}
                  style={styles.dayRow}>
                  <View style={styles.dayIndex}>
                    <AppText style={{ fontSize: 14, fontWeight: '700', color: palette.voltDeep }}>{i + 1}</AppText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText variant="callout">{t(day.title)}</AppText>
                    <AppText variant="footnote" color={palette.caption} style={{ marginTop: 2 }}>
                      {/* Joined rather than glued with a fixed «·». A day whose
                          exercises the author typed themselves has no focus to
                          derive — the muscle names come from the library — and
                          the fixed version opened with a leading separator. */}
                      {[
                        day.focus ? t(day.focus) : day.focus,
                        exs.length
                          ? t('{n} hərəkət · ~{min} dəq', { n: exs.length, min: estimateDurationMin(exs), count: exs.length })
                          : t('hərəkət əlavə olunmayıb'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </AppText>
                  </View>
                  <Icon name="chevR" size={18} color={palette.tertiary} />
                </PressableScale>
              );
            })
          ) : (
            <View style={styles.empty}>
              <Icon name="dumbbell" size={22} color={palette.tertiary} />
              <AppText variant="headline" style={{ marginTop: 10 }}>
                {t('Bu proqramın günləri hələ əlavə olunmayıb')}
              </AppText>
              <AppText variant="footnote" color={palette.caption} style={{ marginTop: 6, textAlign: 'center', lineHeight: 18 }}>
                {mine
                  ? t('Öz proqramındır — redaktə edib gün və hərəkət əlavə edə bilərsən.')
                  : t('Müəllif günləri yükləyəndə burada görünəcək. O vaxta qədər başqa proqram seç.')}
              </AppText>
              {/* It pointed at the exercise library before, which is a browsing
                  screen that adds nothing to any program. */}
              {mine ? (
                <Button
                  title={t('Redaktə et')}
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/(tabs)/workout/create', params: { id: p.id } })}
                  style={{ marginTop: 14 }}
                />
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>

      {hasDays ? (
        <View style={styles.footer}>
          <Button title={t('Yoldaşımla başla')} variant="secondary" icon="users" onPress={startWithPartner} style={{ flex: 1 }} />
          <Button title={t('Başla')} onPress={() => start()} style={{ flex: 1 }} />
        </View>
      ) : mine ? (
        <View style={styles.footer}>
          <Button title={t('Hərəkət əlavə et')} icon="plus" full onPress={() => router.push('/(tabs)/workout/exercises')} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.screen, paddingBottom: 60 },
  hero: { borderRadius: 18, overflow: 'hidden', marginTop: 8 },
  creatorCard: { backgroundColor: palette.white, borderRadius: 14, padding: 14, marginTop: 14 },
  metaChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 },
  statBar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  vsep: { width: StyleSheet.hairlineWidth, height: 16, backgroundColor: palette.separator },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 14, padding: 14, marginBottom: 10 },
  dayIndex: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(198,255,61,0.22)', alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', backgroundColor: palette.white, borderRadius: 16, padding: 22 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 30, backgroundColor: 'rgba(244,244,246,0.96)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
});
