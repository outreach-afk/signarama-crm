export type Stage = 'new' | 'contacted' | 'quoted' | 'negotiating' | 'won' | 'completed' | 'lost'
export type Source = 'apollo' | 'revscale' | 'website' | 'referral' | 'walk_in' | 'other'
export type ActivityType = 'call' | 'email' | 'sms' | 'note' | 'stage_change' | 'visit'

export interface Lead {
  id: string
  created_at: string
  updated_at: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  company: string | null
  title: string | null
  source: Source
  source_subtype: string | null
  stage: Stage
  deal_value: number | null
  next_step: string | null
  next_step_due: string | null
  assigned_to: string | null
  apollo_id: string | null
  revscale_id: string | null
  intent_score: number | null
  notes: string | null
  lost_reason: string | null
  completed_at: string | null
  project_type: string | null
  tags: string[]
}

export interface Activity {
  id: string
  created_at: string
  lead_id: string
  user_id: string
  type: ActivityType
  body: string | null
  outcome: string | null
  user_name: string | null
}

export interface AiDraft {
  id: string
  created_at: string
  lead_id: string
  draft_type: 'sms' | 'email'
  to_address: string | null
  to_phone: string | null
  subject: string | null
  body: string
  inbox: string | null
  approved_at: string | null
  sent_at: string | null
}

export interface User {
  id: string
  email: string
  full_name: string | null
  role: 'owner' | 'manager' | 'bdr' | 'viewer'
  avatar_url: string | null
}

export type LeadInsert = Partial<Omit<Lead, 'id' | 'created_at' | 'updated_at'>>
export type ActivityInsert = Partial<Omit<Activity, 'id' | 'created_at'>>

export interface Database {
  public: {
    Tables: {
      leads: {
        Row: Lead
        Insert: LeadInsert
        Update: LeadInsert
      }
      activities: {
        Row: Activity
        Insert: ActivityInsert
        Update: ActivityInsert
      }
      ai_drafts: {
        Row: AiDraft
        Insert: Partial<Omit<AiDraft, 'id' | 'created_at'>>
        Update: Partial<Omit<AiDraft, 'id' | 'created_at'>>
      }
      profiles: {
        Row: User
        Insert: Partial<Omit<User, 'id'>>
        Update: Partial<Omit<User, 'id'>>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
