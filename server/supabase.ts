import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL) {
  throw new Error(
    "SUPABASE_URL must be set. Did you forget to configure Supabase?",
  );
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY must be set. Did you forget to configure Supabase?",
  );
}

// Create Supabase client with service role key for backend operations
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Database types for TypeScript
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          password: string;
          name: string;
          role: string;
          plan: string;
          plan_activated_at: string | null;
          plan_expires_at: string | null;
          monthly_usage: number;
          last_usage_reset: string;
          created_at: string;
          cancel_at_period_end: boolean;
        };
        Insert: {
          id?: string;
          email: string;
          password: string;
          name: string;
          role?: string;
          plan?: string;
          plan_activated_at?: string | null;
          plan_expires_at?: string | null;
          monthly_usage?: number;
          last_usage_reset?: string;
          created_at?: string;
          cancel_at_period_end?: boolean;
        };
        Update: {
          id?: string;
          email?: string;
          password?: string;
          name?: string;
          role?: string;
          plan?: string;
          plan_activated_at?: string | null;
          plan_expires_at?: string | null;
          monthly_usage?: number;
          last_usage_reset?: string;
          created_at?: string;
          cancel_at_period_end?: boolean;
        };
      };
      documents: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          document_id: string;
          original_content: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          document_id: string;
          original_content?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          document_id?: string;
          original_content?: string | null;
          created_at?: string;
        };
      };
      payments: {
        Row: {
          id: string;
          user_id: string;
          dodo_purchase_id: string;
          product_id: string;
          amount: number;
          currency: string;
          status: string;
          payment_method: string | null;
          customer_email: string | null;
          subscription_start_date: string | null;
          subscription_end_date: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          dodo_purchase_id: string;
          product_id: string;
          amount: number;
          currency?: string;
          status: string;
          payment_method?: string | null;
          customer_email?: string | null;
          subscription_start_date?: string | null;
          subscription_end_date?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          dodo_purchase_id?: string;
          product_id?: string;
          amount?: number;
          currency?: string;
          status?: string;
          payment_method?: string | null;
          customer_email?: string | null;
          subscription_start_date?: string | null;
          subscription_end_date?: string | null;
          created_at?: string;
        };
      };
      otps: {
        Row: {
          id: string;
          email: string;
          otp: string;
          expires_at: string;
          user_data: any;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          otp: string;
          expires_at: string;
          user_data: any;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          otp?: string;
          expires_at?: string;
          user_data?: any;
          created_at?: string;
        };
      };
      guest_usage: {
        Row: {
          id: string;
          browser_id: string;
          count: number;
          documents: string[];
          first_used: string;
          last_used: string;
        };
        Insert: {
          id?: string;
          browser_id: string;
          count?: number;
          documents?: string[];
          first_used?: string;
          last_used?: string;
        };
        Update: {
          id?: string;
          browser_id?: string;
          count?: number;
          documents?: string[];
          first_used?: string;
          last_used?: string;
        };
      };
      reviews: {
        Row: {
          id: string;
          document_id: string;
          user_id: string | null;
          browser_id: string | null;
          rating: number;
          reasons: string[];
          feedback: string;
          user_type: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          user_id?: string | null;
          browser_id?: string | null;
          rating: number;
          reasons?: string[];
          feedback?: string;
          user_type: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          user_id?: string | null;
          browser_id?: string | null;
          rating?: number;
          reasons?: string[];
          feedback?: string;
          user_type?: string;
          created_at?: string;
        };
      };
    };
  };
}