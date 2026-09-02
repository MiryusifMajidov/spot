import { Stack } from 'expo-router';

export const unstable_settings = { initialRouteName: 'index' };

export default function DiscoverLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="filter" options={{ presentation: 'modal' }} />
      <Stack.Screen name="cards" options={{ presentation: 'modal' }} />
      <Stack.Screen name="match" options={{ presentation: 'modal', animation: 'fade' }} />
      <Stack.Screen name="partner-filter" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
