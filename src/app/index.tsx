import { Redirect } from 'expo-router';

// The app opens on Compare with the keypad ready (SPEC "No onboarding").
export default function Index() {
  return <Redirect href="/compare" />;
}
