import { Redirect } from 'expo-router';

/**
 * Replaces expo-router's built-in sitemap.
 *
 * Without this file expo-router adds a `_sitemap` route to every build, release
 * included (getRoutesCore.js only skips it when the app ships its own). So
 * `spot://_sitemap` — from an old share link, a typed URL, anyone who knows the
 * scheme — opened a fully English developer screen listing every route file in
 * the app and a «System Information» block with the SDK and Hermes versions,
 * reachable with no sign-in and no gate. A file with this name is the documented
 * way to take it out; it sends the visitor to the front door instead.
 */
export default function Sitemap() {
  return <Redirect href="/" />;
}
