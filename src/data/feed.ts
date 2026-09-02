export interface FeedVideo {
  id: string;
  author: string;
  /** profiles.id of whoever posted it — null on rows written before author
   *  identity existed. Never guess it from the display name: two people can
   *  share a name, and a name can change. */
  authorId?: string | null;
  verified: boolean;
  isTrainer: boolean;
  caption: string;
  hashtags: string[];
  likes: number;
  comments: number;
  linkedProgramTitle: string;
  linkedProgramId: string;
  gradient: [string, string];
  videoUrl: string;
}

export interface CommunityPost {
  id: string;
  author: string;
  /** profiles.id of the poster — see FeedVideo.authorId. */
  authorId?: string | null;
  gym: string;
  timeAgo: string;
  type: 'progress' | 'text';
  text: string;
  stats?: { label: string; value: string }[];
  likes: number;
  comments: number;
  trainerComment?: { name: string; text: string };
}

/** Empty on purpose.
 *
 *  This array used to hold three "demo" clips: fabricated like and comment
 *  counts (2418 / 184), authorship credited to people who do not exist — two of
 *  them wearing a blue verification badge — and, because their video_url was
 *  null, a Big Buck Bunny / Sintel cartoon played underneath a caption that
 *  presented it as deadlift technique coaching.
 *
 *  The feed shows only what somebody really uploaded. On a fresh install it is
 *  empty, and the screen already says so honestly («Hələ video yoxdur — birinci
 *  sən ol»). */
export const feedVideos: FeedVideo[] = [];

/** Empty on purpose — same reason as `feedVideos`.
 *
 *  These posts invented people, invented their results («-6 kq», «46 məşq»),
 *  invented the engagement, and signed a coaching reply with a trainer's name.
 *  SPOT never writes a message and puts someone else's name on it. */
export const communityPosts: CommunityPost[] = [];
