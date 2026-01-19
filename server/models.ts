import { z } from 'zod';

// Zod schemas for validation
export const insertUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

export const insertDocumentSchema = z.object({
  user_id: z.string().uuid(),
  name: z.string(),
  document_id: z.string(),
  original_content: z.string().optional(),
});

export const insertPaymentSchema = z.object({
  user_id: z.string().uuid(),
  dodo_purchase_id: z.string(),
  product_id: z.string(),
  amount: z.number(),
  status: z.string(),
});

// Types for Supabase tables
export type UserType = {
  id: string;
  email: string;
  password: string;
  name: string;
  role: string;
  plan: string;
  plan_activated_at?: string | null;
  plan_expires_at?: string | null;
  monthly_usage: number;
  last_usage_reset: string;
  created_at: string;
  cancel_at_period_end: boolean;
};

export type DocumentType = {
  id: string;
  user_id: string;
  name: string;
  document_id: string;
  original_content?: string | null;
  created_at: string;
};

export type PaymentType = {
  id: string;
  user_id: string;
  dodo_purchase_id: string;
  product_id: string;
  amount: number;
  currency: string;
  status: string;
  payment_method?: string | null;
  customer_email?: string | null;
  subscription_start_date?: string | null;
  subscription_end_date?: string | null;
  created_at: string;
};

export type OTPType = {
  id: string;
  email: string;
  otp: string;
  expires_at: string;
  user_data: any;
  created_at: string;
};

export type GuestUsageType = {
  id: string;
  browser_id: string;
  count: number;
  documents: string[];
  first_used: string;
  last_used: string;
};

export type ReviewType = {
  id: string;
  document_id: string;
  user_id?: string | null;
  browser_id?: string | null;
  rating: number;
  reasons: string[];
  feedback: string;
  user_type: string;
  created_at: string;
};

// Paragraph structure for the editor
export interface DocxParagraph {
  id: string | null;
  text: string;
  style?: string;
  isEmpty?: boolean;
  styleInfo?: string | null;
  inheritStyleFrom?: string;
}