import { Fragment, ReactNode } from 'react';
import { StyleProp, TextStyle } from 'react-native';

import { AppText } from '@/components/ui/AppText';

/**
 * A translated sentence with live pieces inside it — a tappable link, a bold
 * e-mail address.
 *
 * `t()` returns a string, and some sentences are not strings: «Davam etməklə
 * İSTİFADƏ ŞƏRTLƏRİ və MƏXFİLİK SİYASƏTİ ilə razılaşırsan» carries two links.
 * Splitting it into fragments to translate one by one produces broken Russian
 * and English — both put the verb and its objects in a different order — so the
 * migration rightly left it untranslated, on the very first screen a Russian
 * speaker sees.
 *
 * Instead the WHOLE sentence is translated with placeholders, and this splits
 * the translated text around them:
 *
 *   <Trans
 *     text={t('Davam etməklə {terms} və {privacy} ilə razılaşırsan.')}
 *     parts={{ terms: <Link …>{t('İstifadə şərtləri')}</Link>, privacy: … }}
 *   />
 *
 * Each language puts `{terms}` wherever its grammar needs it. A placeholder the
 * translation dropped simply does not render; one with no matching part is shown
 * as written, so a mistake is visible rather than silent.
 */
export function Trans({
  text,
  parts,
  style,
}: {
  text: string;
  parts: Record<string, ReactNode>;
  style?: StyleProp<TextStyle>;
}) {
  // split() with a capturing group keeps the names at the odd indices.
  const pieces = text.split(/\{(\w+)\}/);
  return (
    <AppText style={style}>
      {pieces.map((piece, i) => {
        if (i % 2 === 0) return piece ? <Fragment key={i}>{piece}</Fragment> : null;
        return <Fragment key={i}>{piece in parts ? parts[piece] : `{${piece}}`}</Fragment>;
      })}
    </AppText>
  );
}
