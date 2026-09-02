import { Stack } from 'expo-router';

export const unstable_settings = { initialRouteName: 'index' };

export default function FeedLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="creator" />
      <Stack.Screen name="share" options={{ presentation: 'modal' }} />
      <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
