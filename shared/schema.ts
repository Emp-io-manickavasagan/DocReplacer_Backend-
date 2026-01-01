import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("USER"), // USER, ADMIN
  plan: text("plan").notNull().default("FREE"), // FREE, PRO
  monthlyUsage: integer("monthly_usage").notNull().default(0),
  lastUsageReset: timestamp("last_usage_reset").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// We store document state to allow editing before export
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  name: text("name").notNull(),
  // Internal DOCX ID to link back to the file if needed, 
  // though for memory storage we might just rely on the session/upload
  // For this architecture, we'll assume we parse and return structure, 
  // and export takes the structure back to rebuild.
  // But if we need to "edit existing paragraphs", we need the original file or structure.
  // We'll store the original file structure (paragraphs) as JSON.
  originalContent: text("original_content"), // JSON string of original paragraphs
  createdAt: timestamp("created_at").defaultNow(),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  razorpayOrderId: text("razorpay_order_id").notNull(),
  razorpayPaymentId: text("razorpay_payment_id"),
  amount: integer("amount").notNull(),
  status: text("status").notNull(), // created, paid, failed
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true
});

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  createdAt: true
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Document = typeof documents.$inferSelect;
export type Payment = typeof payments.$inferSelect;

// Paragraph structure for the editor
export interface DocxParagraph {
  id: string;
  text: string;
  style?: string;
  // We can add more properties as needed for faithful reconstruction
}
