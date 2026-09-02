import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { UiHost } from '@/components/ui/UiHost';
import { useAppStore } from '@/store/appStore';
import { palette } from '@/theme';

export default function RootLayout() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    console.log('[fonts]', 'loaded=', fontsLoaded, 'error=', fontError ? String(fontError) : 'none');
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* Render once font loading has SETTLED either way — a font failure must
            never leave the user staring at a permanently blank screen; the system
            face is a fine fallback. */}
        {fontsLoaded || fontError ? (
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="trainer" />
            <Stack.Screen name="gym" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="chat" />
            <Stack.Screen name="challenge" />
          </Stack>
        ) : (
          <View style={{ flex: 1, backgroundColor: palette.inkText }} />
        )}
        <UiHost />
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
