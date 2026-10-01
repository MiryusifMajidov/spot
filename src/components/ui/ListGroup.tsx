import { Children, Fragment, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { palette, radius } from '@/theme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { Icon, IconName } from '../Icon';

/** iOS grouped-list container. Wrap ListRow children. */
export function ListGroup({ header, footer, children }: { header?: string; footer?: string; children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <View style={{ marginBottom: 8 }}>
      {header ? (
        <AppText variant="overline" color={palette.caption} style={styles.header}>
          {header}
        </AppText>
      ) : null}
      <View style={styles.group}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={styles.sep} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? (
        <AppText variant="footnote" color={palette.caption} style={styles.footer}>
          {footer}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * A settings-style row.
 *
 * The icon tile is NEUTRAL by default — light grey with an ink glyph. It used to
 * be a colour per row in the manner of iOS Settings (blue, green, orange, grey,
 * black and red in one list), which is a second palette next to SPOT's own and the
 * reason the app read as «some icons blue, some green». Colour on a tile now
 * MEANS something, so a caller passes `iconBg` only for a state: red for danger or
 * an unprotected account, streak for a failure, volt for «active / protected».
 * A coloured tile gets a white glyph unless `iconColor` says otherwise (volt
 * takes ink: white on volt is 1.2:1).
 */
export function ListRow({
  icon,
  iconBg,
  iconColor,
  title,
  subtitle,
  value,
  onPress,
  chevron = true,
  danger,
  right,
}: {
  icon?: IconName;
  iconBg?: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  chevron?: boolean;
  danger?: boolean;
  right?: ReactNode;
}) {
  const body = (
    <View style={styles.row}>
      {icon ? (
        <View style={[styles.iconBox, { backgroundColor: iconBg ?? palette.element }]}>
          {/* 20, not 16: the glyphs fill only the middle ~70% of their 24-unit box,
              so 16 drew a ~10 pt mark in the 30 pt tile — the Settings and Privacy
              icons owners called «too small». 20 is about half the tile, the
              proportion of iOS Settings. */}
          <Icon name={icon} size={20} color={iconColor ?? (iconBg ? palette.white : palette.inkText)} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <AppText variant="body" color={danger ? palette.red : palette.inkText}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="footnote" color={palette.caption} style={{ marginTop: 2 }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <AppText variant="body" color={palette.caption}>
          {value}
        </AppText>
      ) : null}
      {right}
      {onPress && chevron && !right ? <Icon name="chevR" size={17} color={palette.tertiary} /> : null}
    </View>
  );

  if (onPress) {
    return (
      <PressableScale activeScale={0.99} haptic={false} onPress={onPress}>
        {body}
      </PressableScale>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  header: { marginLeft: 4, marginBottom: 8 },
  footer: { marginLeft: 4, marginTop: 8, lineHeight: 18 },
  group: { backgroundColor: palette.white, borderRadius: radius.card, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 52, paddingVertical: 10 },
  iconBox: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: palette.separator, marginLeft: 14 },
});
