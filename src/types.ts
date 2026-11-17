export interface User {
  id: number;
  email: string;
  name: string;
  role: 'student' | 'admin';
  student_id: string;
  phone: string;
  auth_provider: 'local' | 'google';
  otp_verified: number;
  avatar_url: string;
  created_at: string;
}

export interface ItemImage {
  id: number;
  item_id: number;
  url: string;
  is_primary: number;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface Item {
  id: number;
  type: 'lost' | 'found';
  title: string;
  description: string;
  category: string;
  location: string;
  item_date: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  status: 'Open' | 'Matched' | 'Under Verification' | 'Recovered';
  reporter_id: number;
  ai_tags: string;
  created_at: string;
  updated_at: string;
  images: ItemImage[];
  claim_count: number;
}

export interface MatchRecord {
  id: number;
  lost_item_id: number;
  found_item_id: number;
  score: number;
  reason: string;
  ai_verified: number;
  status: 'Suggested' | 'Confirmed' | 'Dismissed';
  created_at: string;
  lost_title: string;
  lost_description?: string;
  lost_category?: string;
  lost_location: string;
  lost_date: string;
  lost_email?: string;
  lost_status?: string;
  lost_image?: string;
  found_title: string;
  found_description?: string;
  found_category?: string;
  found_location: string;
  found_date: string;
  found_email?: string;
  found_status?: string;
  found_image?: string;
}

export interface ClaimRecord {
  id: number;
  item_id: number;
  claimant_id: number;
  claimant_name: string;
  claimant_email: string;
  claimant_phone: string;
  proof_description: string;
  identifying_details: string;
  status: 'Pending' | 'Under Verification' | 'Approved' | 'Rejected' | 'Recovered';
  admin_notes: string;
  created_at: string;
  updated_at: string;
  item_title?: string;
  item_type?: 'lost' | 'found';
  item_category?: string;
  item_location?: string;
  item_status?: string;
  item_image?: string;
}

export interface NotificationRecord {
  id: number;
  user_id: number | null;
  user_email: string;
  title: string;
  message: string;
  type: 'match' | 'claim' | 'recovery' | 'system';
  related_item_id: number | null;
  is_read: number;
  created_at: string;
}

export interface StatsOverview {
  total_items: number;
  lost_count: number;
  found_count: number;
  recovered_count: number;
  active_count: number;
  active_matches: number;
  total_claims: number;
  open_claims: number;
  categories: Array<{ category: string; count: number }>;
}

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}
