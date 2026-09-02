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

export function ListRow({
  icon,
  iconBg,
  iconColor = palette.white,
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
        <View style={[styles.iconBox, { backgroundColor: iconBg ?? palette.ink }]}>
          <Icon name={icon} size={16} color={iconColor} />
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
