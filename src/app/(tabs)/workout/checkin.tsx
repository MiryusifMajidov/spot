/**
 * The Məşq tab's own check-in route.
 *
 * The screen itself moved to the ROOT route `src/app/checkin.tsx`. It is opened
 * from two different tabs — the Məşq home tile and the Kəşf gym page — and while
 * it lived only here, opening it from Kəşf switched the focused tab to Məşq, so
 * its `router.back()` popped inside the MƏŞQ stack and returned the person to
 * Məşq home instead of the gym page they came from.
 *
 * This file stays so the Məşq tile's `/(tabs)/workout/checkin` keeps working and
 * keeps its correct in-tab back behaviour. One screen, one set of rules, two
 * entrances.
 */
export { default } from '@/app/checkin';
