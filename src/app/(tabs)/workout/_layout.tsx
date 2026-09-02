import { Stack } from 'expo-router';

export const unstable_settings = { initialRouteName: 'index' };

export default function WorkoutLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="weight" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
