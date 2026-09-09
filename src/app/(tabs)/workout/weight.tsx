import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { parseDecimal } from '@/lib/az';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { Screen } from '@/components/ui/Screen';
import { logWeight } from '@/lib/api';
import { useAuthGate } from '@/lib/authGate';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useDb } from '@/store/db';
import { palette, spacing } from '@/theme';

export default function WeightLog() {
  const router = useRouter();
  const gate = useAuthGate();
  const [kg, setKg] = useState('');
  const [saving, setSaving] = useState(false);

  /* `Number('72,5')` is NaN, and on an Azerbaijani keypad the decimal key IS a
     comma — so this screen refused to save at all for anybody whose phone types
     one: the button stayed disabled and nothing said why. */
  const val = parseDecimal(kg);

  const save = () => {
    if (!val || saving) return;
    gate(async () => {
      setSaving(true);
      // Same shared id as the workout path: the engine assigns it, the server
      // row carries it, so the two copies are one entry.
      const weightId = useDb.getState().logWeight(val);
      if (hasSupabaseConfig) {
        try {
          await logWeight(val, weightId);
        } catch {
          /* keep going; graceful */
        }
      }
      router.back();
    }, 'Çəki qeyd etmək üçün');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title="Çəki qeyd et" right={<Button title="Yadda saxla" variant="volt" disabled={!val || saving} onPress={save} />} />
      <View style={styles.body}>
        <AppText variant="body" color={palette.textSecondary} style={{ marginBottom: 24, lineHeight: 21 }}>
          Bugünkü çəkini yaz. Vaxt keçdikcə dəyişimi profilində qrafik kimi görəcəksən.
        </AppText>
        <View style={styles.inputRow}>
          <TextInput value={kg} onChangeText={setKg} placeholder="78.5" placeholderTextColor={palette.tertiary} keyboardType="decimal-pad" autoFocus style={styles.input} />
          <AppText variant="title2" color={palette.textSecondary}>
            kq
          </AppText>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.screen, paddingTop: 20 },
  inputRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  input: { fontSize: 44, fontWeight: '700', color: palette.inkText, minWidth: 140 },
});
