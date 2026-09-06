import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { createReport } from '@/lib/api';
import { hasSupabaseConfig } from '@/lib/supabase';
import { toast } from '@/store/ui';
import { palette, radius, spacing } from '@/theme';

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
      toast('Göndərilə bilmədi — server bağlantısı yoxdur', 'error');
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
      toast('Göndərilə bilmədi. Yenidən cəhd et.', 'error');
      return;
    }
    toast('Göndərildi — komanda baxacaq');
    router.back();
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar
        title="Kömək və dəstək"
        right={<Button title="Göndər" variant="volt" disabled={!canSend} onPress={send} />}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <AppText variant="overline" color={palette.caption}>
          MÖVZU
        </AppText>
        <View style={styles.cats}>
          {CATEGORIES.map((c) => {
            const on = c.key === cat.key;
            return (
              <PressableScale
                key={c.key}
                activeScale={0.97}
                onPress={() => setCat(c)}
                style={[styles.cat, on && styles.catOn]}>
                <AppText style={[styles.catLabel, on && styles.catLabelOn]}>{c.label}</AppText>
              </PressableScale>
            );
          })}
        </View>

        <AppText variant="overline" color={palette.caption} style={{ marginTop: 22 }}>
          NƏ BAŞ VERDİ?
        </AppText>
        <TextInput
          value={note}
          onChangeText={(t) => setNote(t.slice(0, MAX_CHARS))}
          placeholder={cat.hint}
          placeholderTextColor={palette.caption}
          multiline
          style={styles.input}
        />
        <View style={styles.meter}>
          <AppText variant="caption" color={tooShort ? palette.red : palette.caption}>
            {tooShort
              ? `Ən azı ${MIN_CHARS} simvol — komanda nə baş verdiyini bilməlidir`
              : `${text.length}/${MAX_CHARS}`}
          </AppText>
        </View>

        <AppText variant="caption" color={palette.caption} style={{ marginTop: 18, lineHeight: 19 }}>
          Mesajın SPOT komandasına gedir. Məşq tarixçən, çəkin və söhbətlərin göndərilmir —
          yalnız burada yazdıqların.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
