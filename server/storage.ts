import { User, Document, Payment, type UserType, type DocumentType, type PaymentType } from "./models";

export interface IStorage {
  // Check and downgrade expired PRO users
  checkExpiredPlans(): Promise<void>;
  
  // Get user's active subscription
  getUserSubscription(userId: string): Promise<PaymentType | null>;
  
  // User
  getUser(id: string): Promise<UserType | null>;
  getUserByEmail(email: string): Promise<UserType | null>;
  createUser(user: { email: string; password: string; role?: string; isVerified?: boolean }): Promise<UserType>;
  updateUserPlan(userId: string, plan: string): Promise<void>;
  updatePlanActivationDate(userId: string, date: Date): Promise<void>;
  updateUserRole(userId: string, role: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  updateUserPassword(email: string, hashedPassword: string): Promise<void>;
  incrementMonthlyUsage(userId: string): Promise<void>;
  resetMonthlyUsage(userId: string): Promise<void>;
  
  // Document
  createDocument(doc: { userId: string; name: string; documentId: string; originalContent: string }): Promise<DocumentType>;
  getDocument(documentId: string): Promise<DocumentType | null>;
  
  // Payment
  createPayment(payment: { userId: string; dodoPurchaseId: string; productId: string; amount: number; status: string; customerEmail?: string }): Promise<PaymentType>;
  updatePaymentStatus(dodoPurchaseId: string, status: string, subscriptionData?: { startDate: Date; endDate: Date }): Promise<void>;
  getPaymentByPurchaseId(dodoPurchaseId: string): Promise<PaymentType | null>;
  getPayments(): Promise<PaymentType[]>;
  getUsers(): Promise<UserType[]>;
}

export class DatabaseStorage implements IStorage {
  async checkExpiredPlans(): Promise<void> {
    const now = new Date();
    await User.updateMany(
      { 
        plan: 'PRO', 
        planExpiresAt: { $lt: now } 
      },
      { 
        plan: 'FREE',
        planExpiresAt: null,
        monthlyUsage: 0
      }
    );
  }

  async getUserSubscription(userId: string): Promise<PaymentType | null> {
    return await Payment.findOne({ 
      userId, 
      status: 'completed',
      subscriptionEndDate: { $gte: new Date() }
    }).sort({ createdAt: -1 });
  }

  async getUser(id: string): Promise<UserType | null> {
    return await User.findById(id);
  }

  async getUserByEmail(email: string): Promise<UserType | null> {
    return await User.findOne({ email });
  }

  async createUser(insertUser: { email: string; password: string; role?: string; isVerified?: boolean }): Promise<UserType> {
    const user = new User(insertUser);
    return await user.save();
  }

  async updateUserPlan(userId: string, plan: string): Promise<void> {
    const now = new Date();
    const expiresAt = plan === 'PRO' ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : null; // 1 day
    
    await User.findByIdAndUpdate(userId, { 
      plan,
      planActivatedAt: now,
      planExpiresAt: expiresAt
    });
  }

  async updatePlanActivationDate(userId: string, date: Date): Promise<void> {
    await User.findByIdAndUpdate(userId, { planActivatedAt: date });
  }

  async updateUserRole(userId: string, role: string): Promise<void> {
    await User.findByIdAndUpdate(userId, { role });
  }

  async deleteUser(userId: string): Promise<void> {
    await User.findByIdAndDelete(userId);
    await Document.deleteMany({ userId });
    await Payment.deleteMany({ userId });
  }

  async incrementMonthlyUsage(userId: string): Promise<void> {
    await User.findByIdAndUpdate(userId, { $inc: { monthlyUsage: 1 } });
  }

  async resetMonthlyUsage(userId: string): Promise<void> {
    await User.findByIdAndUpdate(userId, { 
      monthlyUsage: 0, 
      lastUsageReset: new Date() 
    });
  }

  async updateUserPassword(email: string, hashedPassword: string): Promise<void> {
    await User.findOneAndUpdate({ email }, { password: hashedPassword });
  }

  async createDocument(doc: { userId: string; name: string; documentId: string; originalContent: string }): Promise<DocumentType> {
    const document = new Document(doc);
    return await document.save();
  }

  async getDocument(documentId: string): Promise<DocumentType | null> {
    return await Document.findOne({ documentId });
  }

  async createPayment(payment: { userId: string; dodoPurchaseId: string; productId: string; amount: number; status: string; customerEmail?: string }): Promise<PaymentType> {
    const p = new Payment(payment);
    return await p.save();
  }

  async updatePaymentStatus(dodoPurchaseId: string, status: string, subscriptionData?: { startDate: Date; endDate: Date }): Promise<void> {
    const updates: any = { status };
    if (subscriptionData) {
      updates.subscriptionStartDate = subscriptionData.startDate;
      updates.subscriptionEndDate = subscriptionData.endDate;
    }
    await Payment.findOneAndUpdate({ dodoPurchaseId }, updates);
  }

  async getPaymentByPurchaseId(dodoPurchaseId: string): Promise<PaymentType | null> {
    return await Payment.findOne({ dodoPurchaseId });
  }
  
  async getPayments(): Promise<PaymentType[]> {
    return await Payment.find();
  }

  async getUsers(): Promise<UserType[]> {
    return await User.find();
  }
}

export const storage = new DatabaseStorage();
