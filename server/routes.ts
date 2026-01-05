import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import bcrypt from "bcryptjs";
import multer from "multer";
import crypto from "crypto";
import { docxService, fileBufferStore, paragraphMappings } from "./docx.service";
import { authenticateToken, authorizeRole, checkPlanLimit, generateToken, type AuthRequest } from "./middleware";
import { sendOTP, generateOTP } from "./email.service";
import { OTP, Payment } from "./models";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Check expired plans every hour
  setInterval(async () => {
    try {
      await storage.checkExpiredPlans();
      console.log('✅ Checked for expired plans:', new Date().toISOString());
    } catch (error) {
      console.error('❌ Error checking expired plans:', error);
    }
  }, 60 * 60 * 1000); // 1 hour

  // Initial check on startup
  setTimeout(async () => {
    try {
      await storage.checkExpiredPlans();
      console.log('✅ Initial expired plans check completed');
    } catch (error) {
      console.error('❌ Initial expired plans check failed:', error);
    }
  }, 5000); // 5 seconds after startup

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV 
    });
  });

  // === AUTH ===
  app.post('/api/auth/send-otp', async (req, res) => {
    try {
      const { email, password, name } = req.body;
      
      if (!email || !password || !name) {
        return res.status(400).json({ message: "Email, password, and name are required" });
      }
      
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters long" });
      }
      
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ message: "Email already exists" });
      }

      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      
      await OTP.deleteMany({ email });
      await OTP.create({ email, otp, expiresAt, userData: { email, password, name } });
      
      await sendOTP(email, otp);
      
      res.json({ message: "OTP sent successfully" });
      
    } catch (err) {
      console.error('Send OTP error:', err);
      res.status(500).json({ message: "Failed to send OTP", error: err.message });
    }
  });

  app.post('/api/auth/verify-otp', async (req, res) => {
    try {
      const { email, otp } = req.body;
      
      if (!email || !otp) {
        return res.status(400).json({ message: "Email and OTP are required" });
      }
      
      const otpRecord = await OTP.findOne({ email, otp });
      
      if (!otpRecord || otpRecord.expiresAt < new Date()) {
        return res.status(400).json({ message: "Invalid or expired OTP" });
      }

      const { userData } = otpRecord;
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      const user = await storage.createUser({ ...userData, password: hashedPassword, isVerified: true });
      
      await OTP.deleteOne({ _id: otpRecord._id });
      
      const token = generateToken({ id: user._id, email: user.email, role: user.role, plan: user.plan });
      res.status(201).json({ token, user: { id: user._id, email: user.email, role: user.role, plan: user.plan } });
    } catch (err) {
      console.error('OTP verification error:', err);
      res.status(500).json({ message: "Verification failed" });
    }
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({ message: "Email not found" });
      }

      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      
      await OTP.deleteMany({ email });
      await OTP.create({ email, otp, expiresAt, userData: { type: 'password_reset' } });
      
      await sendOTP(email, otp);
      
      res.json({ message: "Password reset OTP sent to email" });
      
    } catch (err) {
      console.error('Forgot password error:', err);
      res.status(500).json({ message: "Failed to send reset OTP", error: err.message });
    }
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    try {
      const { email, otp, newPassword } = req.body;
      const otpRecord = await OTP.findOne({ email, otp });
      
      if (!otpRecord || otpRecord.expiresAt < new Date()) {
        return res.status(400).json({ message: "Invalid or expired OTP" });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUserPassword(email, hashedPassword);
      
      await OTP.deleteOne({ _id: otpRecord._id });
      
      res.json({ message: "Password reset successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Password reset failed" });
    }
  });
  app.post(api.auth.register.path, async (req, res) => {
    console.log('Register route hit with body:', req.body);
    try {
      const input = api.auth.register.input.parse(req.body);
      const existing = await storage.getUserByEmail(input.email);
      if (existing) {
        return res.status(400).json({ message: "Email already exists" });
      }

      const hashedPassword = await bcrypt.hash(input.password, 10);
      const user = await storage.createUser({ ...input, password: hashedPassword });
      const token = generateToken({ id: user._id, email: user.email, role: user.role, plan: user.plan });
      
      res.status(201).json({ token, user: { id: user._id, email: user.email, role: user.role, plan: user.plan } });
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

      const token = generateToken({ id: user._id, email: user.email, role: user.role, plan: user.plan });
      res.status(200).json({ token, user: { id: user._id, email: user.email, role: user.role, plan: user.plan } });
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get('/api/user/me', authenticateToken, async (req: AuthRequest, res) => {
    // Check for expired plans before returning user data
    await storage.checkExpiredPlans();
    
    const user = await storage.getUser(req.user!.id);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    
    // Get subscription details
    const subscription = await storage.getUserSubscription(req.user!.id);
    
    res.json({ 
      id: user._id, 
      email: user.email, 
      role: user.role, 
      plan: user.plan, 
      monthlyUsage: user.monthlyUsage || 0,
      planExpiresAt: user.planExpiresAt,
      subscription: subscription ? {
        purchaseId: subscription.dodoPurchaseId,
        startDate: subscription.subscriptionStartDate,
        endDate: subscription.subscriptionEndDate,
        amount: subscription.amount
      } : null
    });
  });

  // === DOCX ===
  app.post(api.docx.upload.path, authenticateToken, checkPlanLimit, upload.single('file'), async (req: AuthRequest, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    if (!req.file.originalname.endsWith('.docx')) {
      return res.status(400).json({ message: "Only .docx files are allowed" });
    }

    try {
      const result = await docxService.parse(req.file.buffer);
      const documentId = crypto.randomUUID();
      
      console.log('DOCX parsed successfully:');
      console.log('Number of paragraphs:', result.nodes.length);
      console.log('First 5 paragraphs:', result.nodes.slice(0, 5));
      
      // Store file buffer and paragraph mapping for later export
      fileBufferStore.set(documentId, req.file.buffer);
      paragraphMappings.set(documentId, result.paragraphMap);

      // Save metadata
      await storage.createDocument({
        userId: req.user!.id,
        name: req.file.originalname,
        documentId,
        originalContent: JSON.stringify(result.nodes)
      });

      res.json({ documentId, paragraphs: result.nodes });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to parse DOCX" });
    }
  });

  app.post(api.docx.export.path, authenticateToken, async (req: AuthRequest, res) => {
    console.log('Export route hit');
    try {
      const { documentId, paragraphs } = req.body;
      console.log('Export request:', { documentId, paragraphs: paragraphs?.length });
      
      const originalBuffer = fileBufferStore.get(documentId);
      const paragraphMap = paragraphMappings.get(documentId);
      console.log('Original buffer found:', !!originalBuffer);
      console.log('Paragraph map found:', !!paragraphMap);
      
      if (!originalBuffer || !paragraphMap) {
        console.log('Missing data for documentId:', documentId);
        return res.status(404).json({ message: "Original document not found (session expired?)" });
      }
      
      console.log('Starting DOCX rebuild...');
      // Rebuild DOCX with proper paragraph mapping
      const newBuffer = await docxService.rebuild(originalBuffer, paragraphs, paragraphMap);
      console.log('DOCX rebuild successful, buffer size:', newBuffer.length);
      
      // Increment usage count on successful export
      await storage.incrementMonthlyUsage(req.user!.id);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="edited_${documentId}.docx"`);
      res.send(newBuffer);
    } catch (err) {
      console.error('Export error:', err);
      res.status(500).json({ message: "Failed to export DOCX" });
    }
  });

  // === PAYMENT ===
  app.post('/api/payment/create-order', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { amount } = req.body;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Valid amount is required' });
      }
      
      // Create order with Dodo Payments
      const orderId = `order_${Date.now()}_${req.user!.id}`;
      
      res.json({
        orderId,
        amount,
        currency: 'INR',
        key: process.env.DODO_API_KEY
      });
    } catch (error) {
      console.error('Create order error:', error);
      res.status(500).json({ error: 'Failed to create payment order' });
    }
  });

  app.post('/api/payment/verify', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { orderId, paymentId, status } = req.body;
      
      if (!orderId || !paymentId || !status) {
        return res.status(400).json({ error: 'Missing payment verification data' });
      }
      
      if (status === 'success') {
        // Create payment record
        await storage.createPayment({
          userId: req.user!.id,
          dodoPurchaseId: paymentId,
          productId: 'pro_plan',
          amount: 300,
          status: 'completed',
          customerEmail: req.user!.email
        });
        
        // Upgrade user to PRO
        await storage.updateUserPlan(req.user!.id, 'PRO');
        
        res.json({ success: true, message: 'Payment verified and plan upgraded' });
      } else {
        res.status(400).json({ error: 'Payment verification failed' });
      }
    } catch (error) {
      console.error('Payment verification error:', error);
      res.status(500).json({ error: 'Payment verification failed' });
    }
  });
  app.post('/api/payment/dodo-webhook', async (req, res) => {
    try {
      console.log('🔔 WEBHOOK RECEIVED - Raw body:', JSON.stringify(req.body, null, 2));
      console.log('🔔 WEBHOOK HEADERS:', JSON.stringify(req.headers, null, 2));
      
      const { event_type, data } = req.body;
      
      console.log('🔔 Dodo webhook received:', { event_type, data });
      
      if (event_type === 'purchase.completed') {
        const { purchase_id, product_id, customer_email, amount } = data;
        
        console.log('💳 Processing payment:', { purchase_id, customer_email, amount });
        
        // Validate required fields
        if (!purchase_id || !customer_email || !amount) {
          console.error('❌ Missing required webhook data');
          return res.status(400).json({ error: 'Missing required webhook data' });
        }
        
        // Find user by email
        const user = await storage.getUserByEmail(customer_email);
        if (!user) {
          console.error('❌ User not found for email:', customer_email);
          return res.status(404).json({ error: 'User not found' });
        }
        
        console.log('👤 Found user:', user.email, 'ID:', user._id);
        
        // Create payment record first
        const paymentRecord = await storage.createPayment({
          userId: user._id,
          dodoPurchaseId: purchase_id,
          productId: product_id,
          amount: amount,
          status: 'completed',
          customerEmail: customer_email
        });
        
        console.log('💾 Payment record created:', paymentRecord._id);
        
        // Set subscription dates
        const startDate = new Date();
        const endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
        
        // Update payment with subscription dates
        await storage.updatePaymentStatus(purchase_id, 'completed', {
          startDate,
          endDate
        });
        
        console.log('📅 Subscription dates set:', { startDate, endDate });
        
        // Upgrade user to PRO
        await storage.updateUserPlan(user._id, 'PRO');
        
        console.log('✅ User plan upgraded to PRO for:', user.email);
        console.log('🎉 Payment processing completed successfully');
      } else {
        console.log('ℹ️ Webhook event type not handled:', event_type);
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('❌ Dodo webhook error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // Manual payment verification endpoint
  app.post('/api/payment/verify-manual', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { purchase_id } = req.body;
      
      // Check if payment exists and is completed
      const payment = await storage.getPaymentByPurchaseId(purchase_id);
      if (!payment || payment.status !== 'completed') {
        return res.status(400).json({ error: 'Payment not found or not completed' });
      }
      
      // Upgrade user to PRO if not already
      if (payment.userId === req.user!.id) {
        await storage.updateUserPlan(req.user!.id, 'PRO');
        res.json({ success: true, message: 'Plan upgraded successfully' });
      } else {
        res.status(403).json({ error: 'Payment does not belong to this user' });
      }
    } catch (error) {
      console.error('Manual verification error:', error);
      res.status(500).json({ error: 'Verification failed' });
    }
  });
  
  app.get(api.payment.history.path, authenticateToken, async (req, res) => {
    // In a real app we'd filter by user
    const payments = await storage.getPayments();
    res.json(payments);
  });

  // Get user documents
  app.get('/api/user/documents', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const documents = await storage.getUserDocuments(req.user!.id);
      res.json(documents);
    } catch (error) {
      console.error('Get documents error:', error);
      res.status(500).json({ error: 'Failed to fetch documents' });
    }
  });

  // Delete document
  app.delete('/api/user/documents/:documentId', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { documentId } = req.params;
      await storage.deleteDocument(req.user!.id, documentId);
      
      // Clean up memory stores
      fileBufferStore.delete(documentId);
      paragraphMappings.delete(documentId);
      
      res.json({ success: true });
    } catch (error) {
      console.error('Delete document error:', error);
      res.status(500).json({ error: 'Failed to delete document' });
    }
  });

  // Change password
  app.post('/api/user/change-password', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Current and new passwords are required' });
      }
      
      if (newPassword.length < 8) {
        return res.status(400).json({ message: 'New password must be at least 8 characters long' });
      }
      
      const user = await storage.getUser(req.user!.id);
      if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
        return res.status(400).json({ message: 'Current password is incorrect' });
      }
      
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUserPassword(user.email, hashedPassword);
      
      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ error: 'Failed to change password' });
    }
  });

  // Update profile
  app.put('/api/user/profile', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { name } = req.body;
      
      if (!name) {
        return res.status(400).json({ message: 'Name is required' });
      }
      
      await storage.updateUserProfile(req.user!.id, { name });
      res.json({ message: 'Profile updated successfully' });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });
  app.get('/api/user/payments', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const payments = await Payment.find({ userId: req.user!.id }).sort({ createdAt: -1 });
      res.json(payments);
    } catch (error) {
      console.error('Payment history error:', error);
      res.status(500).json({ error: 'Failed to fetch payments' });
    }
  });

  // === ADMIN ===
  app.get(api.admin.users.path, authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const users = await storage.getUsers();
    res.json(users);
  });

  app.put(api.admin.updatePlan.path, authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const { plan } = req.body;
    const userId = req.params.id;
    await storage.updateUserPlan(userId, plan);
    res.json({ success: true });
  });

  app.put('/api/admin/user/:id/role', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const { role } = req.body;
    const userId = req.params.id;
    await storage.updateUserRole(userId, role);
    res.json({ success: true });
  });

  app.put('/api/admin/user/:id/reset-usage', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const userId = req.params.id;
    await storage.resetMonthlyUsage(userId);
    res.json({ success: true });
  });

  app.delete('/api/admin/user/:id', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    const userId = req.params.id;
    await storage.deleteUser(userId);
    res.json({ success: true });
  });

  app.post('/api/user/delete-account', authenticateToken, async (req: AuthRequest, res) => {
    const { password, otp } = req.body;
    const user = await storage.getUser(req.user!.id);
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ message: "Invalid password" });
    }

    const otpRecord = await OTP.findOne({ email: user.email, otp });
    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    await storage.deleteUser(req.user!.id);
    await OTP.deleteOne({ _id: otpRecord._id });
    res.json({ success: true });
  });

  app.post('/api/user/delete-account-otp', authenticateToken, async (req: AuthRequest, res) => {
    const user = await storage.getUser(req.user!.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    
    await OTP.deleteMany({ email: user.email });
    await OTP.create({ email: user.email, otp, expiresAt, userData: { type: 'account_deletion' } });
    
    await sendOTP(user.email, otp);
    res.json({ message: "OTP sent to email" });
  });

  return httpServer;
}
