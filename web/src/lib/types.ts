export interface MediaItem {
  media_key: string;
  type: "photo" | "video" | "animated_gif" | null;
  local_path: string | null;
  alt_text: string | null;
  width: number | null;
  height: number | null;
}

export interface ReferencedPost {
  type: "quoted" | "replied_to" | "retweeted";
  id: string;
  text: string | null;
  author_id: string | null;
  author_username: string | null;
}

export interface Bookmark {
  id: string;
  text: string;
  is_long: boolean;
  created_at: string;
  saved_at: string;
  read_at: string | null;
  notes: string | null;
  tags: string[];
  urls: Array<{ expanded_url: string; display_url: string }> | null;
  referenced: ReferencedPost[] | null;
  metrics: Record<string, number> | null;
  lang: string | null;
  bookmarked: boolean;
  liked: boolean;
  source: "x" | "web" | "youtube";
  author_id: string | null;
  username: string | null;
  author_name: string | null;
  profile_image_url: string | null;
  profile_banner_url: string | null;
  media: MediaItem[];
}

export interface LinkInfo {
  url: string;
  kind: "article" | "github" | "x_article" | "x_post" | "reddit" | "video" | "other";
  title: string | null;
  site_name: string | null;
  description: string | null;
  og_image_path: string | null;
  has_content: boolean;
}

export interface BookmarkWithLink extends Bookmark {
  link: LinkInfo | null;
}

export interface BookmarkDetail extends BookmarkWithLink {
  content: string | null; // sanitized article HTML or raw README markdown
}

export interface FilterOptions {
  authors: Array<{ username: string; name: string | null; count: number }>;
  tags: Array<{ tag: string; count: number }>;
}
