import { User, Document, Payment, GuestUsage, type UserType, type DocumentType, type PaymentType, type GuestUsageType } from "./models";

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
        monthlyUsage: 0,
        cancelAtPeriodEnd: false
      }
    );
  }

  async getUser(id: string): Promise<UserType | null> {
    return await User.findById(id);
  }

  async getUserByEmail(email: string): Promise<UserType | null> {
    return await User.findOne({ email });
  }

  async createUser(insertUser: { email: string; password: string; name: string; role?: string; isVerified?: boolean }): Promise<UserType> {
    const user = new User(insertUser);
    return await user.save();
  }

  async updateUserPlan(userId: string, plan: string): Promise<void> {
    const updates: any = {
      plan,
      cancelAtPeriodEnd: false
    };

    if (plan === 'PRO') {
      updates.planActivatedAt = new Date();
    } else if (plan === 'FREE') {
      updates.planExpiresAt = null;
    }

    const result = await User.findByIdAndUpdate(userId, updates, { new: true });
    if (!result) {
      throw new Error(`Failed to update user plan: ${userId}`);
    }
  }

  async updatePlanActivationDate(userId: string, date: Date): Promise<void> {
    await User.findByIdAndUpdate(userId, { planActivatedAt: date });
  }

  async updateUserRole(userId: string, role: string): Promise<void> {
    await User.findByIdAndUpdate(userId, { role });
  }

  async cancelSubscription(userId: string): Promise<void> {
    await User.findByIdAndUpdate(userId, { cancelAtPeriodEnd: true });
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

  async updateUserProfile(userId: string, profile: { name: string }): Promise<void> {
    await User.findByIdAndUpdate(userId, profile);
  }

  async updateUserPlanExpiration(userId: string, expirationDate: Date): Promise<void> {
    const result = await User.findByIdAndUpdate(userId, { planExpiresAt: expirationDate }, { new: true });
    if (!result) {
      throw new Error(`Failed to update user plan expiration: ${userId}`);
    }
  }

  async createDocument(doc: { userId: string; name: string; documentId: string; originalContent: string }): Promise<DocumentType> {
    const document = new Document(doc);
    return await document.save();
  }

  async getDocument(documentId: string): Promise<DocumentType | null> {
    return await Document.findOne({ documentId });
  }

  async getUserDocuments(userId: string): Promise<DocumentType[]> {
    return await Document.find({ userId }).sort({ createdAt: -1 });
  }

  async deleteDocument(userId: string, documentId: string): Promise<void> {
    await Document.findOneAndDelete({ userId, documentId });
  }

  async getUserSubscription(userId: string): Promise<PaymentType | null> {
    return await Payment.findOne({
      userId,
      status: 'completed',
      subscriptionEndDate: { $gte: new Date() }
    }).sort({ createdAt: -1 });
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
    const result = await Payment.findOneAndUpdate({ dodoPurchaseId }, updates, { new: true });
    if (!result) {
      throw new Error(`Payment not found for update: ${dodoPurchaseId}`);
    }
  }

  async getPaymentByPurchaseId(dodoPurchaseId: string): Promise<PaymentType | null> {
    return await Payment.findOne({ dodoPurchaseId });
  }

  async getUsers(): Promise<UserType[]> {
    return await User.find();
  }

  async getPaymentsByUserId(userId: string): Promise<PaymentType[]> {
    return await Payment.find({ userId }).sort({ createdAt: -1 });
  }

  // Guest Usage Methods
  async getGuestUsage(browserId: string): Promise<GuestUsageType | null> {
    return await GuestUsage.findOne({ browserId });
  }

  async incrementGuestUsage(browserId: string, documentId?: string): Promise<GuestUsageType> {
    let guestUsage = await GuestUsage.findOne({ browserId });
    
    if (!guestUsage) {
      guestUsage = new GuestUsage({
        browserId,
        count: 0,
        documents: [],
        firstUsed: new Date(),
        lastUsed: new Date()
      });
    }
    
    // Only increment if document ID is new or not provided
    if (!documentId || !guestUsage.documents.includes(documentId)) {
      guestUsage.count += 1;
      if (documentId) {
        guestUsage.documents.push(documentId);
      }
    }
    
    guestUsage.lastUsed = new Date();
    return await guestUsage.save();
  }

  async canGuestUse(browserId: string): Promise<boolean> {
    const guestUsage = await GuestUsage.findOne({ browserId });
    if (!guestUsage) {
      return true; // New guest, can use
    }
    return guestUsage.count < 3; // Max 3 uses for guests
  }
}

export const storage = new DatabaseStorage();
