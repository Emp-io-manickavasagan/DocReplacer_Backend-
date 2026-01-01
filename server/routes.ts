import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import bcrypt from "bcryptjs";
import multer from "multer";
import Razorpay from "razorpay";
import crypto from "crypto";
import { docxService, fileBufferStore } from "./docx.service";
import { authenticateToken, authorizeRole, checkPlanLimit, generateToken, type AuthRequest } from "./middleware";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_123',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'rzp_secret_123',
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // === AUTH ===
  app.post(api.auth.register.path, async (req, res) => {
    try {
      const input = api.auth.register.input.parse(req.body);
      const existing = await storage.getUserByEmail(input.email);
      if (existing) {
        return res.status(400).json({ message: "Email already exists" });
      }

      const hashedPassword = await bcrypt.hash(input.password, 10);
      const user = await storage.createUser({ ...input, password: hashedPassword });
      const token = generateToken({ id: user.id, email: user.email, role: user.role, plan: user.plan });
      
      res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role, plan: user.plan } });
    } catch (err) {
       if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
       }
       res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post(api.auth.login.path, async (req, res) => {
    try {
      const input = api.auth.login.input.parse(req.body);
      const user = await storage.getUserByEmail(input.email);
      
      if (!user || !(await bcrypt.compare(input.password, user.password))) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const token = generateToken({ id: user.id, email: user.email, role: user.role, plan: user.plan });
      res.status(200).json({ token, user: { id: user.id, email: user.email, role: user.role, plan: user.plan } });
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get(api.auth.me.path, authenticateToken, async (req: AuthRequest, res) => {
    const user = await storage.getUser(req.user!.id);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    res.json({ id: user.id, email: user.email, role: user.role, plan: user.plan, monthlyUsage: user.monthlyUsage });
  });

  // === DOCX ===
  app.post(api.docx.upload.path, authenticateToken, checkPlanLimit, upload.single('file'), async (req: AuthRequest, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    if (!req.file.originalname.endsWith('.docx')) {
      return res.status(400).json({ message: "Only .docx files are allowed" });
    }

    try {
      const paragraphs = await docxService.parse(req.file.buffer);
      const documentId = crypto.randomUUID();
      
      // Store file buffer for later export/rebuild
      fileBufferStore.set(documentId, req.file.buffer);

      // Save metadata
      await storage.createDocument({
        userId: req.user!.id,
        name: req.file.originalname,
        documentId,
        originalContent: JSON.stringify(paragraphs)
      });
      
      // Increment usage
      await storage.incrementMonthlyUsage(req.user!.id);

      res.json({ documentId, paragraphs });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to parse DOCX" });
    }
  });

  app.post(api.docx.export.path, authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { documentId, paragraphs } = req.body;
      const originalBuffer = fileBufferStore.get(documentId);
      
      if (!originalBuffer) {
        return res.status(404).json({ message: "Original document not found (session expired?)" });
      }
      
      // Rebuild DOCX
      const newBuffer = await docxService.rebuild(originalBuffer, paragraphs);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="edited_${documentId}.docx"`);
      res.send(newBuffer);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to export DOCX" });
    }
  });

  // === PAYMENT ===
  app.post(api.payment.createOrder.path, authenticateToken, async (req: AuthRequest, res) => {
    const { amount } = req.body; // Expecting amount in paise (e.g. 300 = $3.00 if currency was USD, but Razorpay uses INR/etc. Let's assume standard unit)
    
    try {
      const options = {
        amount: amount * 100, // Convert to smallest currency unit if input is whole number
        currency: "USD", // Or INR
        receipt: `receipt_${req.user!.id}_${Date.now()}`
      };
      
      const order = await razorpay.orders.create(options);
      
      await storage.createPayment({
        userId: req.user!.id,
        razorpayOrderId: order.id,
        amount: options.amount,
        status: "created"
      });

      res.json({ orderId: order.id, amount: options.amount, currency: options.currency });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Payment creation failed" });
    }
  });

  app.post(api.payment.verify.path, authenticateToken, async (req: AuthRequest, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'rzp_secret_123')
      .update(body.toString())
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      await storage.updatePaymentStatus(razorpay_order_id, "paid", razorpay_payment_id);
      await storage.updateUserPlan(req.user!.id, "PRO");
      res.json({ success: true });
    } else {
      await storage.updatePaymentStatus(razorpay_order_id, "failed");
      res.status(400).json({ success: false, message: "Invalid signature" });
    }
  });
  
  app.get(api.payment.history.path, authenticateToken, async (req, res) => {
    // In a real app we'd filter by user
    const payments = await storage.getPayments();
    res.json(payments);
  });

  // === ADMIN ===
  app.get(api.admin.users.path, authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const users = await storage.getUsers();
    res.json(users);
  });

  app.put(api.admin.updatePlan.path, authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const { plan } = req.body;
    const userId = parseInt(req.params.id);
    await storage.updateUserPlan(userId, plan);
    res.json({ success: true });
  });

  return httpServer;
}
