import mongoose from 'mongoose';
import { z } from 'zod';

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, default: 'USER', enum: ['USER', 'ADMIN'] },
  plan: { type: String, default: 'FREE', enum: ['FREE', 'PRO'] },
  planActivatedAt: { type: Date, default: Date.now },
  planExpiresAt: { type: Date },
  monthlyUsage: { type: Number, default: 0 },
  lastUsageReset: { type: Date, default: Date.now },
  isVerified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// Document Schema
const documentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  documentId: { type: String, required: true },
  originalContent: { type: String }, // JSON string of original paragraphs
  createdAt: { type: Date, default: Date.now },
});

// Payment Schema
const paymentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dodoPurchaseId: { type: String, required: true },
  productId: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: { type: String, required: true, enum: ['pending', 'completed', 'failed', 'refunded'] },
  paymentMethod: { type: String },
  customerEmail: { type: String },
  subscriptionStartDate: { type: Date },
  subscriptionEndDate: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

// OTP Schema
const otpSchema = new mongoose.Schema({
  email: { type: String, required: true },
  otp: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  userData: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now },
});

// Models
export const User = mongoose.model('User', userSchema);
export const Document = mongoose.model('Document', documentSchema);
export const Payment = mongoose.model('Payment', paymentSchema);
export const OTP = mongoose.model('OTP', otpSchema);

// Zod schemas for validation
export const insertUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

export const insertDocumentSchema = z.object({
  userId: z.string(),
  name: z.string(),
  documentId: z.string(),
  originalContent: z.string().optional(),
});

export const insertPaymentSchema = z.object({
  userId: z.string(),
  dodoPurchaseId: z.string(),
  productId: z.string(),
  amount: z.number(),
  status: z.string(),
});

// Types
export type UserType = {
  _id: string;
  email: string;
  password: string;
  name: string;
  role: string;
  plan: string;
  monthlyUsage: number;
  lastUsageReset: Date;
  createdAt: Date;
};

export type DocumentType = {
  _id: string;
  userId: string;
  name: string;
  documentId: string;
  originalContent?: string;
  createdAt: Date;
};

export type PaymentType = {
  _id: string;
  userId: string;
  dodoPurchaseId: string;
  productId: string;
  amount: number;
  currency: string;
  status: string;
  paymentMethod?: string;
  customerEmail?: string;
  subscriptionStartDate?: Date;
  subscriptionEndDate?: Date;
  createdAt: Date;
};

// Paragraph structure for the editor
export interface DocxParagraph {
  id: string;
  text: string;
  style?: string;
}