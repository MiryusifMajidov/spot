import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { createReport } from '@/lib/api';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useT } from '@/lib/useT';
import { toast } from '@/store/ui';
import { palette, radius, spacing, inputTint } from '@/theme';

/**
 * Kömək və dəstək — with the message actually written by the person.
 *
 * Support used to be three fixed buttons in the settings action sheet, each
 * filing a report whose entire body was a canned phrase: «Tətbiqdə problem».
 * So somebody whose app crashed, whose gym was listed wrong, or who could not
 * sign in had no way to say what happened, and the team received a queue of
 * identical three-word tickets it could do nothing with.
 *
 * The category still matters — it decides the moderator's lane, and safety has a
 * 2-hour SLA — so it is chosen, not typed. The description is the part only the
 * person can supply.
 */

const CATEGORIES = [
  {
    key: 'other' as const,
    label: 'Tətbiqdə problem',
    hint: 'Nə etmək istəyirdin, nə baş verdi? Hansı ekranda?',
  },
  {
    key: 'safety' as const,
    label: 'Təhlükəsizlik',
    hint: 'Kim və nə etdi? Harada baş verdi? Bu növ müraciətlərə ilk baxılır.',
  },
  {
    key: 'spam' as const,
    label: 'Spam və ya saxta profil',
    hint: 'Hansı profil və ya post? Adını və ya linkini yaz.',
  },
  {
    key: 'fake' as const,
    label: 'Səhv məlumat',
    hint: 'Hansı zal, müəllim və ya qiymət səhvdir? Doğrusu nədir?',
  },
];

const MIN_CHARS = 15;
const MAX_CHARS = 1000;

export default function Support() {
  const t = useT();
  const router = useRouter();
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>(CATEGORIES[0]);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const text = note.trim();
  const tooShort = text.length > 0 && text.length < MIN_CHARS;
  const canSend = text.length >= MIN_CHARS && !sending;

  const send = async () => {
    if (!canSend) return;
    if (!hasSupabaseConfig) {
      toast(t('Göndərilə bilmədi — server bağlantısı yoxdur'), 'error');
      return;
    }
    setSending(true);
    try {
      // The category label rides along with the text so the moderator sees the
      // same words the person picked, not just an enum.
      await createReport({
        targetType: 'support',
        targetId: 'app',
        category: cat.key,
        note: `${cat.label}: ${text}`,
      });
    } catch {
      setSending(false);
      // Never «göndərildi» over a write the server refused — the person would
      // wait for an answer to a message nobody received.
      toast(t('Göndərilə bilmədi. Yenidən cəhd et.'), 'error');
      return;
    }
    toast(t('Göndərildi — komanda baxacaq'));
    router.back();
  };

  return (
    <Screen edges={['top', 'bottom']}>
      {/* A text action, as «Yadda saxla» on the profile editor. It was a full
          <Button>, 52 pt tall inside the 44 pt bar, so the volt block spilled past
          the bar's top and bottom. */}
      <NavBar
        title={t('Kömək və dəstək')}
        right={
          <PressableScale
            onPress={send}
            disabled={!canSend}
            haptic={false}
            activeScale={0.94}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            style={styles.navAction}>
            <AppText variant="headline" color={canSend ? palette.inkText : palette.tertiary}>
              {sending ? t('Göndərilir…') : t('Göndər')}
            </AppText>
          </PressableScale>
        }
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <AppText variant="overline" color={palette.caption}>
          {t('MÖVZU')}
        </AppText>
        <View style={styles.cats}>
          {CATEGORIES.map((c) => {
            const on = c.key === cat.key;
            return (
              /* The pill is 39 pt tall (9 + 21 + 9); the slop takes it past 44
                 without changing the look. 4 + 4 fills the 8 pt row gap exactly,
                 so two rows never claim the same point. */
              <PressableScale
                key={c.key}
                activeScale={0.97}
                onPress={() => setCat(c)}
                hitSlop={{ top: 4, bottom: 4 }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.cat, on && styles.catOn]}>
                <AppText style={[styles.catLabel, on && styles.catLabelOn]}>{t(c.label)}</AppText>
              </PressableScale>
            );
          })}
        </View>

        <AppText variant="overline" color={palette.caption} style={{ marginTop: 22 }}>
          {t('NƏ BAŞ VERDİ?')}
        </AppText>
        <TextInput {...inputTint}
          value={note}
          onChangeText={(t) => setNote(t.slice(0, MAX_CHARS))}
          placeholder={t(cat.hint)}
          placeholderTextColor={palette.caption}
          multiline
          style={styles.input}
        />
        <View style={styles.meter}>
          <AppText variant="caption" color={tooShort ? palette.red : palette.caption}>
            {tooShort
              ? t('Ən azı {n} simvol — komanda nə baş verdiyini bilməlidir', { n: MIN_CHARS, count: MIN_CHARS })
              : `${text.length}/${MAX_CHARS}`}
          </AppText>
        </View>

        <AppText variant="caption" color={palette.caption} style={{ marginTop: 18, lineHeight: 19 }}>
          {t('Mesajın SPOT komandasına gedir. Məşq tarixçən, çəkin və söhbətlərin göndərilmir — yalnız burada yazdıqların.')}
        </AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The bar's full 44 pt height; the word itself is far wider than 44.
  navAction: { height: 44, justifyContent: 'center', paddingLeft: spacing.sm },
  body: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 40 },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  cat: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: palette.grouped,
  },
  catOn: { backgroundColor: palette.inkText },
  catLabel: { fontSize: 14, fontWeight: '600', color: palette.text3 },
  catLabelOn: { color: palette.white },
  input: {
    fontSize: 17,
    color: palette.inkText,
    lineHeight: 24,
    minHeight: 150,
    marginTop: 10,
    textAlignVertical: 'top',
  },
  meter: { alignItems: 'flex-end', marginTop: 4 },
});
