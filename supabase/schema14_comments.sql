-- ============================================================================
-- SPOT · schema14_comments.sql
--
-- Comments were never stored on the server. They lived in the device's Zustand
-- store only, so a comment reached nobody — while the sheet invited the user to
-- «Sual ver, texnikanı müzakirə et» (ask a question, discuss the technique), a
-- conversation the app could not actually deliver.
--
-- This makes them real, and adds the two things the owner asked for on top:
-- replies (a thread), and @username mentions.
--
-- Apply AFTER schema13_author_identity.sql.
-- ============================================================================

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  -- Matches the client's key: 'video:<feed_videos.id>' or 'post:<community_posts.id>'.
  -- One text key covers both because their ids are of different types.
  target_key  text not null,
  -- A reply points at the comment it answers. NULL = a top-level comment.
  -- Deleting a parent takes its replies with it, which is what a thread means.
  parent_id   uuid references public.comments(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index if not exists comments_target_idx on public.comments (target_key, created_at);
create index if not exists comments_parent_idx on public.comments (parent_id);
create index if not exists comments_author_idx on public.comments (author_id);

-- ----------------------------------------------------------------------------
-- Likes. A like count only the liker can see is the same fiction the comments
-- themselves were, so this is a real table too.
-- ----------------------------------------------------------------------------
create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, profile_id)
);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.comments      enable row level security;
alter table public.comment_likes enable row level security;

-- Anyone may read: comments are public, like the posts they hang off.
drop policy if exists comments_read on public.comments;
create policy comments_read on public.comments for select using (true);

-- You may only post as yourself.
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
  for insert to authenticated
  with check (author_id in (select p.id from public.profiles p where p.user_id = auth.uid()));

-- You may delete your own comment. So may the author of the video/post it sits
-- on — moderating your own thread is the minimum a creator needs, and it is how
-- every comparable app behaves.
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments
  for delete to authenticated
  using (
    author_id in (select p.id from public.profiles p where p.user_id = auth.uid())
    or exists (
      select 1 from public.feed_videos v
       where 'video:' || v.id = public.comments.target_key
         and v.author_id in (select p.id from public.profiles p where p.user_id = auth.uid())
    )
    or exists (
      select 1 from public.community_posts c
       where 'post:' || c.id::text = public.comments.target_key
         and c.author_id in (select p.id from public.profiles p where p.user_id = auth.uid())
    )
  );

-- Deliberately NO update policy: a comment is not editable, so nobody can change
-- what they said after someone replied to it.

drop policy if exists comment_likes_read on public.comment_likes;
create policy comment_likes_read on public.comment_likes for select using (true);

drop policy if exists comment_likes_insert on public.comment_likes;
create policy comment_likes_insert on public.comment_likes
  for insert to authenticated
  with check (profile_id in (select p.id from public.profiles p where p.user_id = auth.uid()));

drop policy if exists comment_likes_delete on public.comment_likes;
create policy comment_likes_delete on public.comment_likes
  for delete to authenticated
  using (profile_id in (select p.id from public.profiles p where p.user_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- One read for the whole thread: comment + author + like count + did-I-like-it.
--
-- A function rather than client-side joins, because the like count has to be an
-- aggregate over rows belonging to other people, and because the client must
-- never need `select *` on profiles (schema9 withholds `phone`).
--
-- SECURITY INVOKER on purpose: every table it touches is world-readable by
-- policy, so there is nothing to escalate — and it keeps honouring RLS.
-- ----------------------------------------------------------------------------
create or replace function public.comments_for(target text)
returns table (
  id          uuid,
  parent_id   uuid,
  author_id   uuid,
  author_name text,
  author_username text,
  author_avatar   text,
  body        text,
  created_at  timestamptz,
  likes       bigint,
  liked_by_me boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id,
         c.parent_id,
         c.author_id,
         p.name,
         p.username,
         p.avatar_url,
         c.body,
         c.created_at,
         (select count(*) from public.comment_likes l where l.comment_id = c.id),
         exists (
           select 1 from public.comment_likes l
            join public.profiles me on me.id = l.profile_id
           where l.comment_id = c.id and me.user_id = auth.uid()
         )
    from public.comments c
    join public.profiles p on p.id = c.author_id
   where c.target_key = target
   order by coalesce(c.parent_id, c.id), c.created_at
$$;

grant execute on function public.comments_for(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Handle lookup for the @mention picker. Returns only public identity fields —
-- never phone, never anything the profile list does not already expose.
-- ----------------------------------------------------------------------------
create or replace function public.search_handles(q text, max_rows int default 8)
returns table (id uuid, name text, username text, avatar_url text)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, p.name, p.username, p.avatar_url
    from public.profiles p
   where p.username is not null
     and (q = '' or p.username ilike q || '%' or p.name ilike q || '%')
   order by (p.username ilike q || '%') desc, p.username
   limit greatest(1, least(max_rows, 20))
$$;

grant execute on function public.search_handles(text, int) to anon, authenticated;
