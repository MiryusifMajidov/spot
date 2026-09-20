import { Stack } from 'expo-router';

export const unstable_settings = { initialRouteName: 'index' };

export default function WorkoutLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      {/* `weight` was declared here after the screen file was deleted — a
          route expo-router had to reconcile against nothing. */}
    </Stack>
  );
}
