import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
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

  const save = () => {
    const val = Number(kg);
    if (!val || saving) return;
    gate(async () => {
      setSaving(true);
      useDb.getState().logWeight(val); // local engine (authoritative)
      if (hasSupabaseConfig) {
        try {
          await logWeight(val);
        } catch {
          /* keep going; graceful */
        }
      }
      router.back();
    }, 'Çəki qeyd etmək üçün');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title="Çəki qeyd et" right={<Button title="Yadda saxla" variant="volt" disabled={!Number(kg) || saving} onPress={save} />} />
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
