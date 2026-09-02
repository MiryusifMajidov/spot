import { createReport, getMyProfile } from '@/lib/api';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { actionSheet, confirm, toast } from '@/store/ui';

/** Only a real profile row can be blocked server-side; seed partners have
 *  non-uuid ids and stay device-only. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Target = { type: 'user' | 'content' | 'gym' | 'trainer' | 'message'; id: string };

/** The categories `reports.category` accepts and the moderation queue triages on.
 *  'safety' is what puts a report in the 2-hour lane, so it must be reachable from
 *  the app — a hardcoded category made that lane unreachable for every real user. */
export type ReportCategory = 'safety' | 'harassment' | 'spam' | 'fake' | 'other';

const TARGET_LABEL: Record<Target['type'], string> = {
  user: 'İstifadəçi',
  content: 'Məzmun',
  gym: 'Zal',
  trainer: 'Müəllim',
  message: 'Mesaj',
};

/**
 * The one reason picker every report path uses. Concrete reasons only — «Digər»
 * exists as a last resort at the bottom of the list, never as the default, because
 * the category is what decides the SLA (təhlükəsizlik = 2 saat) and the penalty path.
 *
 * `note` gives the moderator the context the queue cannot reconstruct on its own.
 */
export function showReportReasons(opts: {
  title?: string;
  target: Target;
  /** Extra context stored with the report (post text, gym name, …). */
  note?: string;
}) {
  const { target } = opts;

  const submit = async (category: ReportCategory) => {
    if (!hasSupabaseConfig) {
      toast('Şikayət göndərilmədi — bağlantı yoxdur', 'error');
      return;
    }
    const context = [TARGET_LABEL[target.type], opts.note].filter(Boolean).join(' · ');
    try {
      await createReport({
        targetType: target.type,
        targetId: target.id,
        category,
        note: context || undefined,
      });
      toast(
        category === 'safety'
          ? 'Təhlükəsizlik şikayəti göndərildi — təcili baxılır'
          : 'Şikayət göndərildi — komanda baxacaq'
      );
    } catch {
      toast('Şikayət göndərilmədi — yenidən cəhd et', 'error');
    }
  };

  actionSheet({
    title: opts.title ?? 'Şikayət et',
    message: 'Səbəbi seç — moderatorun nə qədər tez baxacağını bu müəyyən edir.',
    actions: [
      { label: 'Təhlükəsizlik / təhdid', style: 'destructive', onPress: () => submit('safety') },
      { label: 'Təqib / təhqir', onPress: () => submit('harassment') },
      { label: 'Spam / reklam', onPress: () => submit('spam') },
      { label: 'Saxta profil və ya məlumat', onPress: () => submit('fake') },
      { label: 'Digər qayda pozuntusu', onPress: () => submit('other') },
      { label: 'Ləğv et', style: 'cancel' },
    ],
  });
}

/** Report / block. A report writes a real row to `reports` (the admin moderation
 *  queue) and only claims success when the write actually succeeded. Blocking is
 *  persisted locally and filters the person out of discovery and chat. */
export function showModerationSheet(name: string, target?: Target) {
  const blocked = target ? useAppStore.getState().blocked.includes(target.id) : false;

  const report = () => {
    if (!target) {
      toast('Şikayət göndərilmədi — bağlantı yoxdur', 'error');
      return;
    }
    showReportReasons({ title: `${name} — şikayət`, target, note: name });
  };

  const toggleBlock = () => {
    if (!target) return;
    const { toggleBlocked } = useAppStore.getState();
    if (blocked) {
      toggleBlocked(target.id);
      if (hasSupabaseConfig && UUID.test(target.id)) {
        unblockProfile(target.id).catch(() => {
          toggleBlocked(target.id);
          toast('Blokdan çıxarmaq alınmadı — yenidən cəhd et', 'error');
        });
      }
      toast(`${name} blokdan çıxarıldı`);
      return;
    }
    confirm('Blok et', `${name} kəşfdə və söhbətlərdə sənə görünməyəcək. İstədiyin vaxt geri qaytara bilərsən.`, [
      { label: 'Ləğv et', style: 'cancel' },
      {
        label: 'Blok et',
        style: 'destructive',
        onPress: () => {
          // The device list is updated first so the UI reacts at once, then the
          // server row decides whether it is real. If that write fails the local
          // flag is rolled back — a block that only this phone knows about is
          // exactly the hole schema38 closed, and claiming it worked would be
          // worse than saying it did not.
          toggleBlocked(target.id);
          if (!hasSupabaseConfig || !UUID.test(target.id)) {
            toast(`${name} yalnız bu cihazda bloklandı — serverə çatmadı`, 'info');
            return;
          }
          blockProfile(target.id)
            .then(() => toast(`${name} bloklandı`))
            .catch(() => {
              toggleBlocked(target.id);
              toast('Bloklamaq alınmadı — yenidən cəhd et', 'error');
            });
        },
      },
    ]);
  };

  actionSheet({
    title: name,
    message: 'Nə etmək istəyirsən?',
    actions: [
      { label: 'Şikayət et', style: 'destructive', onPress: report },
      ...(target ? [{ label: blocked ? 'Blokdan çıxar' : 'Blok et', style: 'destructive' as const, onPress: toggleBlock }] : []),
      { label: 'Ləğv et', style: 'cancel' },
    ],
  });
}

// ---------------------------------------------------------------- blocking --
/**
 * Blocking, on the server.
 *
 * It used to live only in `useAppStore.blocked` (AsyncStorage), which meant «I
 * stop seeing them» and nothing more: the blocked person still saw the profile,
 * could still send a partner request, and the whole list disappeared on
 * reinstall. schema38 adds `public.blocks`; the profile read policy and the
 * match-request policy both consult it, so a block now hides BOTH directions and
 * refuses the request at the database.
 *
 * The device list is kept in step so the UI filters instantly and still works
 * offline — but the server row is what makes the block real.
 */
export async function blockProfile(profileId: string): Promise<void> {
  const me = await getMyProfile();
  if (!me?.id) throw new Error('no profile');
  if (me.id === profileId) throw new Error('self');
  const { data, error } = await supabase
    .from('blocks')
    .insert({ blocker_id: me.id, blocked_id: profileId })
    .select('blocker_id');
  // A duplicate means it is already blocked — that is the desired end state.
  if (error && !String(error.message ?? '').includes('duplicate')) throw error;
  if (!error && !data?.length) throw new Error('block-not-saved');
}

export async function unblockProfile(profileId: string): Promise<void> {
  const me = await getMyProfile();
  if (!me?.id) throw new Error('no profile');
  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', me.id)
    .eq('blocked_id', profileId);
  if (error) throw error;
}

/** Everyone I have blocked, from the server — the device copy is only a cache. */
export async function getBlockedIds(): Promise<string[]> {
  const me = await getMyProfile();
  if (!me?.id) return [];
  const { data, error } = await supabase.from('blocks').select('blocked_id').eq('blocker_id', me.id);
  if (error) throw error;
  return ((data ?? []) as { blocked_id: string }[]).map((r) => r.blocked_id);
}
