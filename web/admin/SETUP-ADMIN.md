# SPOT Admin — setup (real data, real auth)

The admin panel is a real React SPA on the **same Supabase** as the app. It has no
mock data. Admins get elevated access via their authenticated session + admin‑role
RLS — never a service key in the browser. Two one‑time steps by the account owner:

## 1. Apply the admin schema
Supabase Dashboard → your project → **SQL Editor** → paste the contents of
`supabase/schema4_admin.sql` → **Run**. This creates the admin tables (admins,
reports, moderation_actions, trainer_verifications, gym_claims, day_passes,
audit_log), the role helpers, and the RLS that **enforces the privacy red line**
(admins can never read workouts / weights / messages / progress).

> If `schema.sql`, `schema2.sql`, `schema3.sql` were never applied, run those first
> (the catalog data — gyms/trainers/feed — is already present, so they likely were).

## 2. Create the first admin (owner)
1. Dashboard → **Authentication → Users → Add user** → set an email + password
   (this is your admin login). Confirm the email.
2. Dashboard → **SQL Editor**, run (with your email):

```sql
insert into public.admins (user_id, name, email, role, two_factor)
select id, 'Owner', email, 'owner', true
from auth.users where email = 'YOU@example.com'
on conflict (user_id) do update set role = 'owner';
```

Now sign in at the admin URL with that email/password. Add teammates from the
**Admin və audit** screen (owner can set roles: support / moderator / ops / owner).

## Run locally
```bash
cd web/admin
npm install
npm run dev        # http://localhost:5174
```

## Deploy (Fly.io)
```bash
cd web/admin
fly deploy
```
Serves the built SPA; data is live from Supabase at runtime.

## Roles (permission matrix — enforced by RLS)
| Action | Support | Moderator | Ops | Owner |
|---|---|---|---|---|
| Read data, reply to user | ✓ | ✓ | ✓ | ✓ |
| Resolve reports, remove content, punishment ladder | ✗ | ✓ | ✓ | ✓ |
| Trainer verify, gym claim, refunds | ✗ | ✗ | ✓ | ✓ |
| Unmask phone (logged) | ✗ | ✗ | ✓ | ✓ |
| Role management, audit export | ✗ | ✗ | ✗ | ✓ |
| **Weight, progress photo, chat archive** | **✗** | **✗** | **✗** | **✗** |
