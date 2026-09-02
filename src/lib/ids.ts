/**
 * Client-generated row ids.
 *
 * The device engine and the server used to mint their own ids for the same
 * workout — `w-${Date.now()}` here, a Postgres uuid there — so the two copies
 * could never be matched up. That is why the profile could say «0 məşq» while
 * the server held two: nothing could tell whether a server row was already in
 * the local list, so nothing was ever read back.
 *
 * One id, generated here, used in both places. It has to be a real uuid because
 * the server columns are `uuid`.
 *
 * `Math.random` is fine for this: the id only has to be unique, not
 * unguessable — it is never a secret, and every row it names is protected by
 * RLS, not by its id. (Hermes has no `crypto.randomUUID`, and pulling in
 * expo-crypto for an id would be a native dependency for nothing.)
 */
export function newId(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[(Math.random() * 4) | 8];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}

/** Rows written before `newId` existed carry `w-…` / `c-…` ids, which the server
 *  cannot store. They are pushed up under a fresh uuid instead of being lost. */
export const isUuid = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
