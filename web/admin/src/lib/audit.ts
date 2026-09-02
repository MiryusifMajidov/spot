import { supabase } from './supabase';

/** Write an entry to the append-only audit log. Every destructive admin action
 *  must pass a reason (enforced by callers + the moderation_actions schema).
 *
 *  Returns `null` on success, or a human-readable reason the entry was NOT
 *  written. It used to swallow the insert result entirely, so an approval or a
 *  phone unmask whose audit row silently failed still reported success — and
 *  this log is the only record that the action ever happened. A caller that
 *  ignores the return value is asserting the action is not worth auditing. */
export async function audit(
  action: string,
  entity: string,
  entityId: string,
  reason?: string,
  meta?: Record<string, unknown>
): Promise<string | null> {
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user?.id) return 'Admin sessiyası oxunmadı';

  // The admin's display name is a nicety; failing to resolve it must not stop
  // the entry from being written.
  const { data: adminRow } = await supabase
    .from('admins')
    .select('role,name')
    .eq('user_id', data.user.id)
    .maybeSingle();

  const { error } = await supabase.from('audit_log').insert({
    admin_id: data.user.id,
    admin_name: (adminRow as { name?: string } | null)?.name ?? (adminRow as { role?: string } | null)?.role ?? null,
    action,
    entity,
    entity_id: entityId,
    reason: reason ?? null,
    meta: meta ?? null,
  });

  return error ? error.message : null;
}
