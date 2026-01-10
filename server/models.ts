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

// Types
export type UserType = {
  _id: string;
  email: string;
  password: string;
  name: string;
  role: string;
  plan: string;
  planActivatedAt?: Date;
  planExpiresAt?: Date;
  monthlyUsage: number;
  lastUsageReset: Date;
  isVerified?: boolean;
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



// Paragraph structure for the editor
export interface DocxParagraph {
  id: string | null;
  text: string;
  style?: string;
  isEmpty?: boolean;
  styleInfo?: string | null;
  inheritStyleFrom?: string;
}