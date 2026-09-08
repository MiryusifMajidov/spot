export type AdminRole = 'support' | 'moderator' | 'ops' | 'owner';

export interface Admin {
  user_id: string;
  name: string | null;
  email: string | null;
  role: AdminRole;
  two_factor: boolean;
}

export interface Profile {
  id: string;
  user_id: string | null;
  name: string | null;
  gender: string | null;
  age: number | null;
  home_gym_id: string | null;
  level: string | null;
  goals: string[] | null;
  types: string[] | null;
  role: string | null;
  status: 'active' | 'muted' | 'suspended' | 'banned';
  status_reason: string | null;
  /** When a time-boxed sanction lapses. Set for the 7-day mute rung; null for
   *  the indefinite rungs (suspend / ban) and for `active`. */
  status_until: string | null;
  /** These four are NOT columns on `profiles`. That table's `reports_count`,
   *  `requests_sent`, `requests_answered` and `streak_current` were zero on every
   *  row and written by nothing, anywhere — so «yalnız şikayət edilənlər» came
   *  back empty while five reports sat open. They are now computed from the
   *  source rows by `public.admin_profile_stats()` (schema20) and merged in
   *  after the profile fetch. */
  reports_count: number;
  requests_sent: number;
  requests_answered: number;
  /** Counted from CHECK-INS ONLY. Deliberately not the streak the member sees:
   *  theirs also counts logged workouts, and workout detail never leaves their
   *  device. Label it «check-in seriyası», never «streak». */
  checkin_streak: number;
  /** Never present on a row read from the table: schema9 withholds the column
   *  from every client role. The real number comes only from the audited
   *  `admin_unmask_phone` RPC, one profile at a time. */
  phone?: string | null;
  created_at: string;
  last_active_at: string | null;
}

/** One row of `public.admin_profile_stats()` — the counters computed from the
 *  rows that actually exist, rather than from columns nothing maintains. */
export interface ProfileStats {
  profile_id: string;
  reports_count: number;
  requests_sent: number;
  requests_answered: number;
  checkin_streak: number;
  last_check_in: string | null;
}

export interface Gym {
  id: string;
  name: string;
  verified: boolean;
  district: string | null;
  members: number | null;
  trainers: number | null;
  rating: number | null;
  review_count: number | null;
  claim_status: 'unclaimed' | 'pending' | 'claimed';
  /** schema41: a gym created inside the app starts false and is invisible in
   *  Kəşf until an admin publishes it. Nothing could set it before schema50. */
  listed: boolean | null;
  price_month: number | null;
  day_pass: number | null;
}

export interface Trainer {
  id: string;
  name: string;
  verified: boolean;
  gym_id: string | null;
  specialty: string | null;
  rating: number | null;
  clients: number | null;
  price_from: number | null;
  verify_status: 'unverified' | 'pending' | 'approved' | 'rejected';
}

export interface Report {
  id: string;
  reporter_id: string | null;
  /** `support` is a message to the team, NOT a complaint about a person. The
   *  account ladder must stay off for it — there is nobody to sanction. */
  target_type: 'user' | 'content' | 'gym' | 'trainer' | 'message' | 'support';
  target_id: string;
  category: 'safety' | 'harassment' | 'spam' | 'fake' | 'payment' | 'other';
  note: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  sla_due_at: string;
  locked_by: string | null;
  locked_until: string | null;
  resolution: string | null;
  created_at: string;
}

export interface ReportMessage {
  id: string;
  report_id: string;
  sender_name: string | null;
  body: string;
  sent_at: string | null;
  ord: number;
}

export interface TrainerVerification {
  id: string;
  trainer_id: string | null;
  user_id: string | null;
  status: 'pending' | 'approved' | 'rejected';
  doc_id_url: string | null;
  doc_cert_url: string | null;
  gym_confirm: boolean;
  intro_video_url: string | null;
  internal_note: string | null;
  reject_reason: string | null;
  sla_due_at: string;
  created_at: string;
}

export interface GymClaim {
  id: string;
  gym_id: string | null;
  claimant_id: string | null;
  voen: string | null;
  call_code: string | null;
  selfie_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reject_reason: string | null;
  sla_due_at: string;
  created_at: string;
}

/** A day pass is an ISSUANCE record only. SPOT collects no money and takes no
 *  commission, so `price` / `commission` are deliberately NOT modelled here —
 *  nothing in the panel may surface them. Any fee is settled at the gym. */
export interface DayPass {
  id: string;
  user_id: string | null;
  gym_id: string | null;
  code: string | null;
  status: 'active' | 'used' | 'refunded' | 'expired';
  purchased_at: string;
  expires_at: string | null;
}

export interface Challenge {
  id: string;
  title: string;
  scope: string;
  scope_label: string;
  target: number;
  unit: string;
  participants: number;
  active: boolean;
  /* `days_left: number` used to live here. It was an int nothing ever
     decremented, so «11 gün qalıb» stayed 11 forever and an August challenge was
     still shown as running in September. schema60 replaced it with a real
     window. `leaderboard`, `progress` and `day_cells` were dropped as well —
     seeded JSON and a per-challenge «progress» that belonged to nobody. */
  starts_at: string | null;
  ends_at: string | null;
  reward: string | null;
}

export interface CommunityPost {
  id: string;
  author: string;
  gym: string | null;
  body: string;
  type: string;
  likes: number;
  comments: number;
  time_ago: string | null;
  /** Set by a moderator takedown. A row with `hidden_at` is gone from the app;
   *  a row without it is still live no matter what the audit log says. */
  hidden_at?: string | null;
}

export interface FeedVideo {
  id: string;
  author: string;
  verified: boolean;
  is_trainer: boolean;
  caption: string;
  likes: number;
  comments: number;
  video_url: string | null;
  /** Set by a moderator takedown — see CommunityPost.hidden_at. */
  hidden_at?: string | null;
}

export interface AuditRow {
  id: number;
  admin_id: string | null;
  admin_name: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  reason: string | null;
  created_at: string;
}

export interface DashboardKpis {
  users_total: number;
  trainers_pending: number;
  reports_open: number;
  reports_overdue: number;
  claims_pending: number;
  gyms_total: number;
  daypass_active: number;
}
