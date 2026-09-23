/**
 * Take the filming LOCATION out of a video before it is uploaded.
 *
 * The `videos` bucket is PUBLIC: every clip in the feed and every technique cue
 * attached to a program is a plain URL anybody can download. A phone writes the
 * GPS coordinates of the spot where it was filmed into the file itself — iOS
 * and Android both put an ISO 6709 string («+40.3777+049.8920/») in the `©xyz`
 * atom, and some Android builds add a 3GPP `loci` box next to it. Nothing in
 * the app ever shows that, so nobody choosing a clip from the gallery has any
 * reason to suspect they are publishing their home address. The app's own
 * privacy text promises that a person's exact coordinates are never stored on
 * the server; shipping the file untouched would have made that untrue.
 *
 * This is why the fix is not «only allow the in-app camera»: the camera leaks
 * the same atom (iOS writes it whenever the app holds location permission, and
 * SPOT asks for one to sort gyms by distance), while losing the gallery would
 * cost every coach their existing footage.
 *
 * ## How it removes them
 *
 * An MP4/MOV is a tree of boxes: 4-byte big-endian size, 4-byte type, then the
 * payload. Cutting a box out would shift every byte after it, and the sample
 * tables (`stco`) hold ABSOLUTE file offsets — a shrunk `moov` in front of the
 * `mdat` silently breaks playback. So nothing moves: the four type bytes are
 * overwritten with `free`, the box ISO 14496-12 defines as «ignore me, this is
 * padding», and the coordinates inside it are zeroed — a renamed box a player
 * skips would still hand the address to anyone who opens the file in a text
 * editor. Same length, same offsets, every other byte identical.
 *
 * Only the metadata containers are walked (`moov` and what nests inside it);
 * the `mdat` payload is never read or touched. Anything malformed ends the walk
 * where it stands and leaves the rest of the file exactly as it was — a video
 * this cannot parse is uploaded unchanged rather than corrupted, and the caller
 * is told nothing was removed.
 *
 * Known limit, stated honestly: an action camera that records a CONTINUOUS GPS
 * track as its own media track (GoPro GPMF and friends) keeps that track — it
 * lives in `mdat`, not in a metadata atom, and removing it means re-encoding
 * the file. Phone footage, which is everything this app is for, is covered.
 */

/** Every atom known to carry where the camera was standing. */
const LOCATION_ATOMS: ReadonlySet<string> = new Set([
  '©xyz', // QuickTime / iOS / Android: ISO 6709 in moov→udta (and in ilst)
  'xyz ', // the same thing, unprefixed, from some Android encoders
  'loci', // 3GPP location information: coordinates PLUS a place name
  '©gps', // GPS strings written by a few Android OEM camera apps
  'gps ',
  'gpsa',
  'gsst',
  'gstd',
]);

/** Boxes that hold other boxes on the way down to the ones above. `mdat` is
 *  deliberately absent: the picture data is never walked. */
const CONTAINERS: ReadonlySet<string> = new Set(['moov', 'trak', 'udta', 'meta', 'ilst', 'mdia', 'minf']);

/** `free` — «this box is padding» (ISO 14496-12 §8.1.2). */
const FREE = Uint8Array.from([0x66, 0x72, 0x65, 0x65]);

const MAX_DEPTH = 8;

/** The 4 type bytes as latin-1, so `©xyz` compares as a string. */
function typeAt(u8: Uint8Array, off: number): string {
  return String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
}

/** A box header is plausible here: the size fits inside the parent and the type
 *  is printable. Used to tell an ISO `meta` (4 bytes of version+flags first)
 *  from a QuickTime one (children start immediately). */
function looksLikeBox(view: DataView, u8: Uint8Array, off: number, end: number): boolean {
  if (off + 8 > end) return false;
  const size = view.getUint32(off);
  if (size !== 0 && size !== 1 && (size < 8 || off + size > end)) return false;
  for (let i = off + 4; i < off + 8; i++) {
    const c = u8[i];
    // Printable ASCII, or the 0xA9 that starts every Apple-style atom.
    if (c !== 0xa9 && (c < 0x20 || c > 0x7e)) return false;
  }
  return true;
}

function walk(view: DataView, u8: Uint8Array, start: number, end: number, depth: number, removed: string[]): void {
  let off = start;
  while (off + 8 <= end) {
    let size = view.getUint32(off);
    let head = 8;
    if (size === 1) {
      // 64-bit size, in the 8 bytes after the type.
      if (off + 16 > end) return;
      const hi = view.getUint32(off + 8);
      const lo = view.getUint32(off + 12);
      size = hi * 4294967296 + lo;
      head = 16;
    } else if (size === 0) {
      // «to the end of the file» — legal for the last box.
      size = end - off;
    }
    if (size < head || off + size > end) return; // malformed: stop, change nothing more

    const type = typeAt(u8, off + 4);
    if (LOCATION_ATOMS.has(type)) {
      u8.set(FREE, off + 4);
      // And the coordinates themselves. Renaming the box only stops PLAYERS
      // from reading it — the ISO 6709 string would still be sitting in a
      // public file for anyone who opens it in a text editor. The box is
      // padding now, so its contents mean nothing; zeroing keeps the length,
      // and with it every offset, exactly the same.
      u8.fill(0, off + head, off + size);
      removed.push(type);
    } else if (CONTAINERS.has(type) && depth < MAX_DEPTH) {
      let inner = off + head;
      if (type === 'meta' && !looksLikeBox(view, u8, inner, off + size)) {
        inner += 4; // ISO full box: version + flags before the children
      }
      walk(view, u8, inner, off + size, depth + 1, removed);
    }
    off += size;
  }
}

/**
 * Neutralise every location atom, IN PLACE, and return what was found.
 *
 * In place on purpose: the caller is holding the whole clip in memory already
 * (up to 100 MB), and copying it to strip four bytes is how a phone runs out of
 * memory mid-upload. An empty result means the file carried no location — or
 * could not be parsed — and is uploaded byte-for-byte as it was.
 */
export function stripVideoLocation(buffer: ArrayBuffer): string[] {
  const removed: string[] = [];
  if (buffer.byteLength < 16) return removed;
  try {
    const u8 = new Uint8Array(buffer);
    const view = new DataView(buffer);
    walk(view, u8, 0, buffer.byteLength, 0, removed);
  } catch {
    // A file we cannot read is a file we do not damage.
    return removed;
  }
  return removed;
}
