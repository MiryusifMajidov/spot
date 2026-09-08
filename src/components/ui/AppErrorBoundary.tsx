import { Component, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/ui/PressableScale';
import { palette, radius, spacing } from '@/theme';

/**
 * The last thing standing between a render error and a blank screen.
 *
 * React unmounts the whole tree when a render throws and nothing catches it.
 * With no boundary anywhere in this app that meant: the screen goes white, the
 * tab bar goes with it, and there is no button, no message and no way back —
 * the only exit is force-quitting. On a phone that reads as «the app is
 * broken», not «one screen hit a bug».
 *
 * This does three things and nothing more:
 *   · says, in Azerbaijani, that ONE screen failed — not the account, not the
 *     data. Somebody whose workout history is intact should not be left
 *     wondering whether they just lost it.
 *   · offers a retry that remounts the subtree, which is enough for the common
 *     case (a transient shape in a response, a race on first paint).
 *   · shows the real error text under a tap in development only. A user gets no
 *     stack trace, and we do not invent a friendlier cause than the one we have.
 */
interface Props {
  children: ReactNode;
  /** Shown instead of the default title when a specific area is wrapped. */
  label?: string;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // No crash reporter is wired up, so this is the only record that exists.
    // Saying so out loud beats pretending the error went somewhere.
    if (__DEV__) console.error('[ErrorBoundary]', error);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.icon}>
            <Icon name="x" size={26} color={palette.red} />
          </View>
          <AppText variant="title3" center style={{ marginTop: 18 }}>
            {this.props.label ?? 'Bu ekran açılmadı'}
          </AppText>
          <AppText variant="body" color={palette.textSecondary} center style={styles.body}>
            Tətbiqdə xəta baş verdi. Hesabın, məşq tarixçən və digər məlumatların yerindədir — problem
            yalnız bu ekrandadır.
          </AppText>

          <PressableScale activeScale={0.97} onPress={this.reset} style={styles.retry}>
            <AppText style={{ fontSize: 15, fontWeight: '600', color: palette.white }}>Yenidən cəhd et</AppText>
          </PressableScale>

          {__DEV__ ? (
            <AppText variant="caption" color={palette.caption} style={styles.dev}>
              {String(error?.message ?? error)}
            </AppText>
          ) : null}
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.grouped },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.screen },
  icon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { marginTop: 10, lineHeight: 22, maxWidth: 300 },
  retry: {
    marginTop: 22,
    height: 50,
    paddingHorizontal: 28,
    borderRadius: radius.button,
    backgroundColor: palette.inkText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dev: { marginTop: 24, textAlign: 'center', maxWidth: 320, lineHeight: 17 },
});
