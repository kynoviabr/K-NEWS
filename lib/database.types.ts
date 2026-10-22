export type Json = string | number | boolean | null | Record<string, unknown> | unknown[];

export type PortalStatus = "active" | "inactive" | "archived";
export type ArticleStatus = "draft" | "reviewing" | "ready" | "scheduled" | "published" | "blocked" | "archived";
export type RiskLevel = "low" | "medium" | "high" | "blocked";
export type JobStatus = "queued" | "running" | "retrying" | "completed" | "dead_letter" | "cancelled";
export type JobType =
  | "rss_fetch"
  | "normalize"
  | "classify"
  | "draft"
  | "publish"
  | "social_publish"
  | "ad_serve"
  | "affiliate_sync"
  | "research";
export type PortalRole =
  | "super_admin"
  | "regional_manager"
  | "regional_editor"
  | "commercial_partner"
  | "technical_operator"
  | "advertiser";

// Schema knews — espelho mínimo para Fase 1; expandido nas Fases 3-6
export type Database = {
  public: Record<string, never>;
  knews: {
    Tables: {
      regions: {
        Row: { id: string; name: string; slug: string; status: string; created_at: string; updated_at: string };
        Insert: { id?: string; name: string; slug: string; status?: string };
        Update: { name?: string; slug?: string; status?: string };
        Relationships: [];
      };
      portals: {
        Row: { id: string; city_id: string; name: string; slug: string; status: PortalStatus; seo: Json; created_at: string; updated_at: string };
        Insert: { id?: string; city_id: string; name: string; slug: string; status?: PortalStatus; seo?: Json };
        Update: { name?: string; slug?: string; status?: PortalStatus; seo?: Json };
        Relationships: [];
      };
      articles: {
        Row: { id: string; portal_id: string; slug: string; title: string; excerpt: string | null; body: string; status: ArticleStatus; risk_level: RiskLevel; published_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; portal_id: string; slug: string; title: string; excerpt?: string | null; body?: string; status?: ArticleStatus; risk_level?: RiskLevel };
        Update: { slug?: string; title?: string; excerpt?: string | null; body?: string; status?: ArticleStatus; risk_level?: RiskLevel };
        Relationships: [];
      };
      jobs: {
        Row: { id: string; portal_id: string | null; job_type: JobType; status: JobStatus; payload: Json; result: Json | null; priority: number; attempts: number; max_attempts: number; idempotency_key: string | null; scheduled_at: string; claimed_at: string | null; claimed_by: string | null; lease_expires_at: string | null; created_at: string; updated_at: string };
        Insert: { portal_id?: string | null; job_type: JobType; payload?: Json; priority?: number; max_attempts?: number; idempotency_key?: string | null; scheduled_at?: string };
        Update: { status?: JobStatus; result?: Json | null; last_error?: string | null };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
