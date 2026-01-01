import { users, documents, payments, type User, type InsertUser, type Document, type Payment } from "@shared/schema";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";

export interface IStorage {
  // User
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser & { role?: string }): Promise<User>;
  updateUserPlan(userId: number, plan: string): Promise<void>;
  incrementMonthlyUsage(userId: number): Promise<void>;
  resetMonthlyUsage(userId: number): Promise<void>;
  
  // Document
  createDocument(doc: { userId: number; name: string; documentId: string; originalContent: string }): Promise<Document>;
  getDocument(documentId: string): Promise<Document | undefined>;
  
  // Payment
  createPayment(payment: { userId: number; razorpayOrderId: string; amount: number; status: string }): Promise<Payment>;
  updatePaymentStatus(razorpayOrderId: string, status: string, paymentId?: string): Promise<void>;
  getPayments(): Promise<Payment[]>;
  getUsers(): Promise<User[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(insertUser: InsertUser & { role?: string }): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserPlan(userId: number, plan: string): Promise<void> {
    await db.update(users).set({ plan }).where(eq(users.id, userId));
  }

  async incrementMonthlyUsage(userId: number): Promise<void> {
    await db.update(users)
      .set({ monthlyUsage: sql`${users.monthlyUsage} + 1` })
      .where(eq(users.id, userId));
  }

  async resetMonthlyUsage(userId: number): Promise<void> {
    await db.update(users)
      .set({ monthlyUsage: 0, lastUsageReset: new Date() })
      .where(eq(users.id, userId));
  }

  async createDocument(doc: { userId: number; name: string; documentId: string; originalContent: string }): Promise<Document> {
    const [document] = await db.insert(documents).values(doc).returning();
    return document;
  }

  async getDocument(documentId: string): Promise<Document | undefined> {
    const [document] = await db.select().from(documents).where(eq(documents.documentId, documentId));
    return document;
  }

  async createPayment(payment: { userId: number; razorpayOrderId: string; amount: number; status: string }): Promise<Payment> {
    const [p] = await db.insert(payments).values(payment).returning();
    return p;
  }

  async updatePaymentStatus(razorpayOrderId: string, status: string, paymentId?: string): Promise<void> {
    const updates: any = { status };
    if (paymentId) updates.razorpayPaymentId = paymentId;
    await db.update(payments).set(updates).where(eq(payments.razorpayOrderId, razorpayOrderId));
  }
  
  async getPayments(): Promise<Payment[]> {
    return await db.select().from(payments);
  }

  async getUsers(): Promise<User[]> {
    return await db.select().from(users);
  }
}

export const storage = new DatabaseStorage();
