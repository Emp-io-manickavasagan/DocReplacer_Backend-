import { supabase } from "./supabase";
import { UserType, DocumentType, PaymentType, GuestUsageType, OTPType } from "./models";

export interface IStorage {
  // Check and downgrade expired PRO users
  checkExpiredPlans(): Promise<void>;

  // User
  getUser(id: string): Promise<UserType | null>;
  getUserByEmail(email: string): Promise<UserType | null>;
  createUser(user: { email: string; password: string; name: string; role?: string; isVerified?: boolean }): Promise<UserType>;
  updateUserPlan(userId: string, plan: string): Promise<void>;
  updatePlanActivationDate(userId: string, date: Date): Promise<void>;
  updateUserRole(userId: string, role: string): Promise<void>;
  cancelSubscription(userId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  updateUserPassword(email: string, hashedPassword: string): Promise<void>;
  updateUserProfile(userId: string, profile: { name: string }): Promise<void>;
  incrementMonthlyUsage(userId: string): Promise<void>;
  resetMonthlyUsage(userId: string): Promise<void>;
  updateUserPlanExpiration(userId: string, expirationDate: Date): Promise<void>;

  // Document
  createDocument(doc: { userId: string; name: string; documentId: string; originalContent: string }): Promise<DocumentType>;
  getDocument(documentId: string): Promise<DocumentType | null>;
  getUserDocuments(userId: string): Promise<DocumentType[]>;
  deleteDocument(userId: string, documentId: string): Promise<void>;

  // Payment
  getUserSubscription(userId: string): Promise<PaymentType | null>;
  createPayment(payment: { userId: string; dodoPurchaseId: string; productId: string; amount: number; status: string; customerEmail?: string }): Promise<PaymentType>;
  updatePaymentStatus(dodoPurchaseId: string, status: string, subscriptionData?: { startDate: Date; endDate: Date }): Promise<void>;
  getPaymentByPurchaseId(dodoPurchaseId: string): Promise<PaymentType | null>;

  // Guest Usage
  getGuestUsage(browserId: string): Promise<GuestUsageType | null>;
  incrementGuestUsage(browserId: string, documentId?: string): Promise<GuestUsageType>;
  canGuestUse(browserId: string): Promise<boolean>;

  getUsers(): Promise<UserType[]>;
}

export class SupabaseStorage implements IStorage {
  async checkExpiredPlans(): Promise<void> {
    const now = new Date().toISOString();
    
    const { error } = await supabase
      .from('users')
      .update({
        plan: 'FREE',
        plan_expires_at: null,
        monthly_usage: 0,
        cancel_at_period_end: false
      })
      .eq('plan', 'PRO')
      .lt('plan_expires_at', now);

    if (error) {
      console.error('Error checking expired plans:', error);
    }
  }

  async getUser(id: string): Promise<UserType | null> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // No rows returned
      throw error;
    }

    return data;
  }

  async getUserByEmail(email: string): Promise<UserType | null> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // No rows returned
      throw error;
    }

    return data;
  }

  async createUser(insertUser: { email: string; password: string; name: string; role?: string; isVerified?: boolean }): Promise<UserType> {
    const { data, error } = await supabase
      .from('users')
      .insert({
        email: insertUser.email,
        password: insertUser.password,
        name: insertUser.name,
        role: insertUser.role || 'USER'
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async updateUserPlan(userId: string, plan: string): Promise<void> {
    const updates: any = {
      plan,
      cancel_at_period_end: false
    };

    if (plan === 'PRO') {
      updates.plan_activated_at = new Date().toISOString();
    } else if (plan === 'FREE') {
      updates.plan_expires_at = null;
    }

    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId);

    if (error) {
      throw new Error(`Failed to update user plan: ${userId} - ${error.message}`);
    }
  }

  async updatePlanActivationDate(userId: string, date: Date): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ plan_activated_at: date.toISOString() })
      .eq('id', userId);

    if (error) {
      throw error;
    }
  }

  async updateUserRole(userId: string, role: string): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ role })
      .eq('id', userId);

    if (error) {
      throw error;
    }
  }

  async cancelSubscription(userId: string): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ cancel_at_period_end: true })
      .eq('id', userId);

    if (error) {
      throw error;
    }
  }

  async deleteUser(userId: string): Promise<void> {
    // Delete related records first (cascade should handle this, but being explicit)
    await supabase.from('documents').delete().eq('user_id', userId);
    await supabase.from('payments').delete().eq('user_id', userId);
    
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) {
      throw error;
    }
  }

  async incrementMonthlyUsage(userId: string): Promise<void> {
    // Get current usage first
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('monthly_usage')
      .eq('id', userId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    const { error } = await supabase
      .from('users')
      .update({ monthly_usage: (user.monthly_usage || 0) + 1 })
      .eq('id', userId);

    if (error) {
      throw error;
    }
  }

  async resetMonthlyUsage(userId: string): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({
        monthly_usage: 0,
        last_usage_reset: new Date().toISOString()
      })
      .eq('id', userId);

    if (error) {
      throw error;
    }
  }

  async updateUserPassword(email: string, hashedPassword: string): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ password: hashedPassword })
      .eq('email', email);

    if (error) {
      throw error;
    }
  }

  async updateUserProfile(userId: string, profile: { name: string }): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update(profile)
      .eq('id', userId);

    if (error) {
      throw error;
    }
  }

  async updateUserPlanExpiration(userId: string, expirationDate: Date): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ plan_expires_at: expirationDate.toISOString() })
      .eq('id', userId);

    if (error) {
      throw new Error(`Failed to update user plan expiration: ${userId} - ${error.message}`);
    }
  }

  async createDocument(doc: { userId: string; name: string; documentId: string; originalContent: string }): Promise<DocumentType> {
    const { data, error } = await supabase
      .from('documents')
      .insert({
        user_id: doc.userId,
        name: doc.name,
        document_id: doc.documentId,
        original_content: doc.originalContent
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async getDocument(documentId: string): Promise<DocumentType | null> {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('document_id', documentId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // No rows returned
      throw error;
    }

    return data;
  }

  async getUserDocuments(userId: string): Promise<DocumentType[]> {
    const { data, error } = await supabase
      .from('documents')
      .select('id, name, document_id, created_at') // Select only needed fields, exclude large content
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100); // Limit for performance

    if (error) {
      throw error;
    }

    return data || [];
  }

  async deleteDocument(userId: string, documentId: string): Promise<void> {
    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('user_id', userId)
      .eq('document_id', documentId);

    if (error) {
      throw error;
    }
  }

  async getUserSubscription(userId: string): Promise<PaymentType | null> {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('subscription_end_date', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // No rows returned
      throw error;
    }

    return data;
  }

  async createPayment(payment: { userId: string; dodoPurchaseId: string; productId: string; amount: number; status: string; customerEmail?: string }): Promise<PaymentType> {
    const { data, error } = await supabase
      .from('payments')
      .insert({
        user_id: payment.userId,
        dodo_purchase_id: payment.dodoPurchaseId,
        product_id: payment.productId,
        amount: payment.amount,
        status: payment.status,
        customer_email: payment.customerEmail
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async updatePaymentStatus(dodoPurchaseId: string, status: string, subscriptionData?: { startDate: Date; endDate: Date }): Promise<void> {
    const updates: any = { status };
    if (subscriptionData) {
      updates.subscription_start_date = subscriptionData.startDate.toISOString();
      updates.subscription_end_date = subscriptionData.endDate.toISOString();
    }

    const { error } = await supabase
      .from('payments')
      .update(updates)
      .eq('dodo_purchase_id', dodoPurchaseId);

    if (error) {
      throw new Error(`Payment not found for update: ${dodoPurchaseId} - ${error.message}`);
    }
  }

  async getPaymentByPurchaseId(dodoPurchaseId: string): Promise<PaymentType | null> {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('dodo_purchase_id', dodoPurchaseId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // No rows returned
      throw error;
    }

    return data;
  }

  async getUsers(): Promise<UserType[]> {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, role, plan, monthly_usage, plan_activated_at, created_at, plan_expires_at, cancel_at_period_end') // Select only needed fields
      .order('created_at', { ascending: false })
      .limit(1000); // Limit results for performance

    if (error) {
      throw error;
    }

    return data || [];
  }

  async getPaymentsByUserId(userId: string): Promise<PaymentType[]> {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data || [];
  }

  // Guest Usage Methods
  async getGuestUsage(browserId: string): Promise<GuestUsageType | null> {
    const { data, error } = await supabase
      .from('guest_usage')
      .select('*')
      .eq('browser_id', browserId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // No rows returned
      throw error;
    }

    return data;
  }

  async incrementGuestUsage(browserId: string, documentId?: string): Promise<GuestUsageType> {
    let guestUsage = await this.getGuestUsage(browserId);
    
    if (!guestUsage) {
      // Create new guest usage record
      const { data, error } = await supabase
        .from('guest_usage')
        .insert({
          browser_id: browserId,
          count: documentId ? 1 : 0,
          documents: documentId ? [documentId] : [],
          first_used: new Date().toISOString(),
          last_used: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    }
    
    // Update existing record
    let shouldIncrement = false;
    let newDocuments = [...guestUsage.documents];
    
    if (!documentId || !guestUsage.documents.includes(documentId)) {
      shouldIncrement = true;
      if (documentId) {
        newDocuments.push(documentId);
      }
    }
    
    const updates: any = {
      last_used: new Date().toISOString(),
      documents: newDocuments
    };
    
    if (shouldIncrement) {
      updates.count = guestUsage.count + 1;
    }

    const { data, error } = await supabase
      .from('guest_usage')
      .update(updates)
      .eq('browser_id', browserId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async canGuestUse(browserId: string): Promise<boolean> {
    const guestUsage = await this.getGuestUsage(browserId);
    if (!guestUsage) {
      return true; // New guest, can use
    }
    return guestUsage.count < 3; // Max 3 uses for guests
  }

  // OTP Methods
  async createOTP(otp: { email: string; otp: string; expiresAt: Date; userData: any }): Promise<OTPType> {
    const { data, error } = await supabase
      .from('otps')
      .insert({
        email: otp.email,
        otp: otp.otp,
        expires_at: otp.expiresAt.toISOString(),
        user_data: otp.userData
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async getOTP(email: string, otp: string): Promise<OTPType | null> {
    const { data, error } = await supabase
      .from('otps')
      .select('*')
      .eq('email', email)
      .eq('otp', otp)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // No rows returned
      throw error;
    }

    return data;
  }

  async deleteOTP(id: string): Promise<void> {
    const { error } = await supabase
      .from('otps')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }
  }

  async deleteOTPsByEmail(email: string): Promise<void> {
    const { error } = await supabase
      .from('otps')
      .delete()
      .eq('email', email);

    if (error) {
      throw error;
    }
  }

  // Review Methods
  async createReview(review: { documentId: string; userId?: string | null; browserId?: string | null; rating: number; reasons?: string[]; feedback?: string; userType: string }): Promise<any> {
    const { data, error } = await supabase
      .from('reviews')
      .insert({
        document_id: review.documentId,
        user_id: review.userId,
        browser_id: review.browserId,
        rating: review.rating,
        reasons: review.reasons || [],
        feedback: review.feedback || '',
        user_type: review.userType
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async getReviews(): Promise<any[]> {
    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data || [];
  }
}

export const storage = new SupabaseStorage();