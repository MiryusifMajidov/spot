/**
 * The Russian and English dictionaries, keyed by the Azerbaijani source string.
 *
 * Split by area so the files stay readable and can be worked on independently,
 * not because the runtime cares — everything is merged into one map per
 * language at import time.
 *
 * A key missing from a chunk is not an error: `t()` falls back to the
 * Azerbaijani source. `python scripts/check_i18n.py` lists what is missing, so
 * a gap is found by running it rather than by a user meeting it.
 */
import { registerDict } from '@/lib/i18n';

import * as en from './en/index';
import * as ru from './ru/index';

const merge = (mods: Record<string, unknown>) =>
  Object.values(mods).reduce<Record<string, unknown>>(
    (acc, m) => (m && typeof m === 'object' ? { ...acc, ...(m as Record<string, unknown>) } : acc),
    {}
  );

export function loadDictionaries() {
  registerDict('ru', merge(ru) as Parameters<typeof registerDict>[1]);
  registerDict('en', merge(en) as Parameters<typeof registerDict>[1]);
}
