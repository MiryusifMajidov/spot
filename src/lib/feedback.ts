/**
 * One place for every tap reaction in SPOT.
 *
 * Both channels are user-controlled (Parametrlər → Toxunma və səs):
 *   haptics — vibration on press (default ON)
 *   sounds  — short UI tones (default OFF, because most people don't want them)
 *
 * Nothing here may throw: a device without a vibrator, or with audio focus taken
 * by another app, must never break a button.
 */
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

import { useAppStore } from '@/store/appStore';

type Tone = 'tap' | 'success' | 'error';

const SOURCES = {
  tap: require('../../assets/sounds/tap.wav'),
  success: require('../../assets/sounds/success.wav'),
  error: require('../../assets/sounds/error.wav'),
} as const;

const players: Partial<Record<Tone, AudioPlayer>> = {};

/**
 * Swallow the rejection of a promise nobody awaits.
 *
 * The try/catch blocks below could not do this. `Haptics.notificationAsync`,
 * `impactAsync`, `selectionAsync` and `AudioPlayer.seekTo` all return promises,
 * so the very failure the catch documents — no vibrator, audio focus refused, the
 * native module missing from the build — rejected ASYNCHRONOUSLY and walked
 * straight past the synchronous handler. Nothing else attached one, and
 * `tapFeedback()` runs from `PressableScale.onPressIn`, i.e. from every tappable
 * surface in SPOT: on such a device every single press printed «Possible
 * Unhandled Promise Rejection», which in development is a LogBox card thrown over
 * whatever the person was doing. The try/catch stays for the SYNCHRONOUS throw of
 * a missing module.
 */
function ignore(p: unknown): void {
  if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => {});
}

function play(tone: Tone) {
  if (!useAppStore.getState().sounds) return;
  try {
    let p = players[tone];
    if (!p) {
      p = createAudioPlayer(SOURCES[tone]);
      p.volume = tone === 'tap' ? 0.35 : 0.5;
      players[tone] = p;
    }
    ignore(p.seekTo(0));
    ignore(p.play());
  } catch {
    /* audio is a nicety — never let it break an interaction */
  }
}

function buzz(style: 'light' | 'medium' | 'success' | 'error') {
  if (!useAppStore.getState().haptics) return;
  try {
    if (style === 'success') ignore(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    else if (style === 'error') ignore(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
    else if (style === 'medium') ignore(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
    else ignore(Haptics.selectionAsync());
  } catch {
    /* no vibrator on this device */
  }
}

/** Ordinary tap on any control. */
export function tapFeedback() {
  buzz('light');
  play('tap');
}

/** Something completed: workout saved, request sent, profile stored. */
export function successFeedback() {
  buzz('success');
  play('success');
}

/** Something failed and the user must notice. */
export function errorFeedback() {
  buzz('error');
  play('error');
}

/** A heavier press — destructive confirms, primary CTAs. */
export function impactFeedback() {
  buzz('medium');
  play('tap');
}

/** Release the audio players (used when the user turns sounds off). */
export function releaseSounds() {
  (Object.keys(players) as Tone[]).forEach((k) => {
    try {
      players[k]?.remove();
    } catch {
      /* ignore */
    }
    delete players[k];
  });
}
