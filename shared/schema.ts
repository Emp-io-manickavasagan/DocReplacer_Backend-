import { z } from "zod";

// Zod schemas for validation
export const insertUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
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
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string().optional(),
  amount: z.number(),
  status: z.string(),
});

// Types
export type User = {
  _id: string;
  email: string;
  password: string;
  role: string;
  plan: string;
  monthlyUsage: number;
  lastUsageReset: Date;
  createdAt: Date;
};

export type InsertUser = z.infer<typeof insertUserSchema>;

export type Document = {
  _id: string;
  userId: string;
  name: string;
  documentId: string;
  originalContent?: string;
  createdAt: Date;
};

export type Payment = {
  _id: string;
  userId: string;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  amount: number;
  status: string;
  createdAt: Date;
};

// Paragraph structure for the editor
export interface DocxParagraph {
  id: string | null;
  text: string;
  style?: string;
  isEmpty?: boolean;
}
