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
    } catch (error) {
      // Silent error handling
    }
  }, 60 * 60 * 1000);

  // Initial check on startup
  setTimeout(async () => {
    try {
      await storage.checkExpiredPlans();
    } catch (error) {
      // Silent error handling
    }
  }, 5000);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV 
    });
  });

  app.get('/api/health', async (req, res) => {
    try {
      const userCount = await storage.getUsers().then(users => users.length);
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        database: {
          connected: true,
          userCount: userCount
        }
      });
    } catch (error) {
      res.json({ 
        status: 'error', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        database: {
          connected: false,
          error: error.message
        }
      });
    }
  });

  // === AUTH ===
  app.post('/api/auth/send-otp', async (req, res) => {
    try {
      const { email, password, name } = req.body;
      
      // Input validation
      if (!email || !password || !name) {
        return res.status(400).json({ message: "Email, password, and name are required" });
      }
      
      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }
      
      // Password validation
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters long" });
      }
      
      // Name validation
      if (name.length < 2 || name.length > 50) {
        return res.status(400).json({ message: "Name must be between 2 and 50 characters" });
      }
      
      // Sanitize inputs
      const sanitizedEmail = email.toLowerCase().trim();
      const sanitizedName = name.trim();
      
      const existing = await storage.getUserByEmail(sanitizedEmail);
      if (existing) {
        return res.status(400).json({ message: "Email already exists" });
      }

      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      
      await OTP.deleteMany({ email: sanitizedEmail });
      await OTP.create({ email: sanitizedEmail, otp, expiresAt, userData: { email: sanitizedEmail, password, name: sanitizedName } });
      
      try {
        await sendOTP(sanitizedEmail, otp);
      } catch (emailError) {
        // Email failed, continue without logging
      }
      
      res.json({ message: "OTP sent successfully" });
      
    } catch (err) {
      res.status(500).json({ message: "Failed to send OTP" });
    }
  });

  app.post('/api/auth/verify-otp', async (req, res) => {
    try {
      const { email, otp } = req.body;
      
      if (!email || !otp) {
        return res.status(400).json({ message: "Email and OTP are required" });
      }
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }
      
      // Validate OTP format (6 digits)
      if (!/^\d{6}$/.test(otp)) {
        return res.status(400).json({ message: "Invalid OTP format" });
      }
      
      const sanitizedEmail = email.toLowerCase().trim();
      const otpRecord = await OTP.findOne({ email: sanitizedEmail, otp });
      
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
      res.status(500).json({ message: "Verification failed" });
    }
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }
      
      const sanitizedEmail = email.toLowerCase().trim();
      const user = await storage.getUserByEmail(sanitizedEmail);
      if (!user) {
        return res.status(404).json({ message: "Email not found" });
      }

      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      
      await OTP.deleteMany({ email: sanitizedEmail });
      await OTP.create({ email: sanitizedEmail, otp, expiresAt, userData: { type: 'password_reset' } });
      
      try {
        await sendOTP(sanitizedEmail, otp);
      } catch (emailError) {
        // Email failed, continue without logging
      }
      
      res.json({ message: "Password reset OTP sent" });
      
    } catch (err) {
      res.status(500).json({ message: "Failed to send reset OTP" });
    }
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    try {
      const { email, otp, newPassword } = req.body;
      
      // Input validation
      if (!email || !otp || !newPassword) {
        return res.status(400).json({ message: "Email, OTP, and new password are required" });
      }
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }
      
      // Validate OTP format
      if (!/^\d{6}$/.test(otp)) {
        return res.status(400).json({ message: "Invalid OTP format" });
      }
      
      // Validate password strength
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters long" });
      }
      
      const sanitizedEmail = email.toLowerCase().trim();
      const otpRecord = await OTP.findOne({ email: sanitizedEmail, otp });
      
      if (!otpRecord || otpRecord.expiresAt < new Date()) {
        return res.status(400).json({ message: "Invalid or expired OTP" });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUserPassword(sanitizedEmail, hashedPassword);
      
      await OTP.deleteOne({ _id: otpRecord._id });
      
      res.json({ message: "Password reset successfully" });
    } catch (err) {
      res.status(500).json({ message: "Password reset failed" });
    }
  });
  app.post(api.auth.register.path, async (req, res) => {
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
    
    // Validate file type
    if (!req.file.originalname.endsWith('.docx')) {
      return res.status(400).json({ message: "Only .docx files are allowed" });
    }
    
    // Validate file size (10MB limit)
    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ message: "File size must be less than 10MB" });
    }
    
    // Validate filename
    const filename = req.file.originalname;
    if (filename.length > 255 || !/^[a-zA-Z0-9._-]+\.docx$/.test(filename)) {
      return res.status(400).json({ message: "Invalid filename" });
    }

    try {
      const result = await docxService.parse(req.file.buffer);
      const documentId = crypto.randomUUID();
      
      fileBufferStore.set(documentId, req.file.buffer);
      paragraphMappings.set(documentId, result.paragraphMap);

      await storage.createDocument({
        userId: req.user!.id,
        name: filename,
        documentId,
        originalContent: JSON.stringify(result.nodes)
      });

      res.json({ documentId, paragraphs: result.nodes });
    } catch (err) {
      res.status(500).json({ message: "Failed to parse DOCX" });
    }
  });

  app.post(api.docx.export.path, authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { documentId, paragraphs } = req.body;
      
      // Input validation
      if (!documentId || !paragraphs || !Array.isArray(paragraphs)) {
        return res.status(400).json({ message: "Invalid request data" });
      }
      
      // Validate documentId format (UUID)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(documentId)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      // Validate paragraphs array
      if (paragraphs.length > 1000) {
        return res.status(400).json({ message: "Too many paragraphs" });
      }
      
      for (const para of paragraphs) {
        if (!para.id || typeof para.text !== 'string') {
          return res.status(400).json({ message: "Invalid paragraph format" });
        }
        if (para.text.length > 10000) {
          return res.status(400).json({ message: "Paragraph too long" });
        }
      }
      
      const originalBuffer = fileBufferStore.get(documentId);
      const paragraphMap = paragraphMappings.get(documentId);
      
      if (!originalBuffer || !paragraphMap) {
        return res.status(404).json({ message: "Original document not found (session expired?)" });
      }
      
      const newBuffer = await docxService.rebuild(originalBuffer, paragraphs, paragraphMap);
      
      await storage.incrementMonthlyUsage(req.user!.id);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="edited_${documentId}.docx"`);
      res.send(newBuffer);
    } catch (err) {
      res.status(500).json({ message: "Failed to export DOCX" });
    }
  });

  // === PAYMENT ===
  app.post('/api/payment/create-order', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { amount } = req.body;
      
      // Input validation
      if (!amount || typeof amount !== 'number' || amount <= 0 || amount > 10000) {
        return res.status(400).json({ error: 'Invalid amount' });
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
      res.status(500).json({ error: 'Failed to create payment order' });
    }
  });

  app.post('/api/payment/verify', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { orderId, paymentId, status } = req.body;
      
      // Input validation
      if (!orderId || !paymentId || !status) {
        return res.status(400).json({ error: 'Missing payment verification data' });
      }
      
      // Validate input formats
      if (typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof status !== 'string') {
        return res.status(400).json({ error: 'Invalid data types' });
      }
      
      // Validate orderId belongs to current user
      if (!orderId.includes(req.user!.id)) {
        return res.status(403).json({ error: 'Unauthorized payment verification' });
      }
      
      if (status === 'success') {
        // Create payment record
        const paymentRecord = await storage.createPayment({
          userId: req.user!.id,
          dodoPurchaseId: paymentId,
          productId: 'pro_plan',
          amount: 300,
          status: 'completed',
          customerEmail: req.user!.email
        });
        
        // Set subscription dates
        const startDate = new Date();
        const endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        
        await storage.updatePaymentStatus(paymentId, 'completed', {
          startDate,
          endDate
        });
        
        // Upgrade user to PRO
        await storage.updateUserPlan(req.user!.id, 'PRO');
        
        // Get updated user data
        const updatedUser = await storage.getUser(req.user!.id);
        
        res.json({ 
          success: true, 
          message: 'Payment verified and plan upgraded',
          payment: {
            id: paymentRecord._id,
            amount: paymentRecord.amount,
            currency: 'INR',
            status: 'completed',
            purchaseId: paymentId,
            planActivatedAt: startDate,
            planExpiresAt: endDate
          },
          user: {
            plan: updatedUser?.plan,
            planExpiresAt: updatedUser?.planExpiresAt
          },
          redirectUrl: `${process.env.FRONTEND_URL || 'https://www.docreplacer.online'}/payment-success?payment=${paymentRecord._id}`
        });
      } else {
        res.status(400).json({ error: 'Payment verification failed' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Payment verification failed' });
    }
  });
  app.post('/api/payment/dodo-webhook', async (req, res) => {
    try {
      const { type, data } = req.body;
      
      // Input validation
      if (!type || !data || typeof type !== 'string') {
        return res.status(400).json({ error: 'Invalid webhook data' });
      }
      
      // Handle subscription activation events
      const activationEvents = [
        'subscription.active',
        'subscription.renewed'
      ];
      
      // Handle subscription update events
      const updateEvents = [
        'subscription.updated',
        'subscription.plan_changed'
      ];
      
      // Handle subscription deactivation events
      const deactivationEvents = [
        'subscription.cancelled',
        'subscription.expired',
        'subscription.failed'
      ];
      
      // Handle subscription hold events
      const holdEvents = [
        'subscription.on_hold'
      ];
      
      if (activationEvents.includes(type)) {
        // ACTIVATE PRO PLAN
        const { subscription_id, customer, status, next_billing_date, expires_at } = data;
        
        if (!subscription_id || !customer?.email) {
          return res.status(400).json({ error: 'Missing required subscription data' });
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customer.email)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }
        
        const sanitizedEmail = customer.email.toLowerCase().trim();
        const user = await storage.getUserByEmail(sanitizedEmail);
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        
        // Check if payment record already exists
        let paymentRecord = await storage.getPaymentByPurchaseId(subscription_id);
        
        if (!paymentRecord) {
          paymentRecord = await storage.createPayment({
            userId: user._id,
            dodoPurchaseId: subscription_id,
            productId: data.product_id || 'pro_plan',
            amount: data.recurring_pre_tax_amount || 300,
            status: 'completed',
            customerEmail: sanitizedEmail
          });
        }
        
        // Set subscription dates
        const startDate = new Date();
        const endDate = expires_at ? new Date(expires_at) : 
                       next_billing_date ? new Date(next_billing_date) :
                       new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        
        await storage.updatePaymentStatus(subscription_id, 'completed', { startDate, endDate });
        await storage.updateUserPlan(user._id, 'PRO');
        
        const redirectUrl = `${process.env.FRONTEND_URL || 'https://www.docreplacer.online'}/payment-success?subscription_id=${subscription_id}`;
        
        res.json({ 
          success: true,
          redirect_url: redirectUrl,
          message: `PRO plan activated via ${type}`,
          subscription_end_date: endDate.toISOString()
        });
        
      } else if (updateEvents.includes(type)) {
        // UPDATE SUBSCRIPTION
        const { subscription_id, customer, status, next_billing_date, expires_at } = data;
        
        if (!customer?.email) {
          return res.status(400).json({ error: 'Missing customer email' });
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customer.email)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }
        
        const sanitizedEmail = customer.email.toLowerCase().trim();
        const user = await storage.getUserByEmail(sanitizedEmail);
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        
        // Update subscription if subscription_id provided
        if (subscription_id) {
          const startDate = new Date();
          const endDate = expires_at ? new Date(expires_at) : 
                         next_billing_date ? new Date(next_billing_date) :
                         new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
          
          await storage.updatePaymentStatus(subscription_id, 'completed', { startDate, endDate });
        }
        
        // Keep PRO plan active if subscription is active
        if (status === 'active' || status === 'pending') {
          await storage.updateUserPlan(user._id, 'PRO');
        }
        
        res.json({ 
          success: true,
          message: `Subscription updated via ${type}`
        });
        
      } else if (deactivationEvents.includes(type)) {
        // DEACTIVATE PRO PLAN
        const { subscription_id, customer } = data;
        
        if (!customer?.email) {
          return res.status(400).json({ error: 'Missing customer email' });
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customer.email)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }
        
        const sanitizedEmail = customer.email.toLowerCase().trim();
        const user = await storage.getUserByEmail(sanitizedEmail);
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        
        // Update payment status if subscription_id provided
        if (subscription_id) {
          await storage.updatePaymentStatus(subscription_id, 'cancelled', {
            startDate: new Date(),
            endDate: new Date() // Expire immediately
          });
        }
        
        // Downgrade to FREE plan
        await storage.updateUserPlan(user._id, 'FREE');
        
        res.json({ 
          success: true,
          message: `PRO plan deactivated via ${type}`
        });
        
      } else if (holdEvents.includes(type)) {
        // HANDLE SUBSCRIPTION ON HOLD
        const { subscription_id, customer } = data;
        
        if (!customer?.email) {
          return res.status(400).json({ error: 'Missing customer email' });
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customer.email)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }
        
        const sanitizedEmail = customer.email.toLowerCase().trim();
        const user = await storage.getUserByEmail(sanitizedEmail);
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        
        // Update payment status but keep plan active for now
        if (subscription_id) {
          await storage.updatePaymentStatus(subscription_id, 'on_hold');
        }
        
        res.json({ 
          success: true,
          message: `Subscription on hold via ${type}`
        });
        
      } else {
        // Log unsupported event types for debugging
        res.json({ 
          success: true,
          message: `Received unsupported event: ${type}`
        });
      }
    } catch (error) {
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // Quick PRO activation
  app.post('/api/payment/quick-activate', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const paymentRecord = await storage.createPayment({
        userId: req.user!.id,
        dodoPurchaseId: `quick_${Date.now()}`,
        productId: 'pro_plan',
        amount: 300,
        status: 'completed',
        customerEmail: user.email
      });
      
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      
      await storage.updatePaymentStatus(paymentRecord.dodoPurchaseId, 'completed', {
        startDate,
        endDate
      });
      
      await storage.updateUserPlan(req.user!.id, 'PRO');
      
      res.json({ 
        success: true, 
        message: 'PRO plan activated successfully',
        paymentId: paymentRecord._id
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to activate PRO plan' });
    }
  });

  // Manual payment activation
  app.post('/api/payment/activate-pro', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { purchaseId } = req.body;
      
      if (!purchaseId) {
        return res.status(400).json({ error: 'Purchase ID is required' });
      }
      
      // Create payment record
      const paymentRecord = await storage.createPayment({
        userId: req.user!.id,
        dodoPurchaseId: purchaseId,
        productId: 'pro_plan',
        amount: 300,
        status: 'completed',
        customerEmail: req.user!.email
      });
      
      // Set subscription dates
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      
      await storage.updatePaymentStatus(purchaseId, 'completed', {
        startDate,
        endDate
      });
      
      // Upgrade user to PRO
      await storage.updateUserPlan(req.user!.id, 'PRO');
      
      // Get updated user data
      const updatedUser = await storage.getUser(req.user!.id);
      
      res.json({ 
        success: true, 
        message: 'PRO plan activated successfully',
        payment: {
          id: paymentRecord._id,
          amount: paymentRecord.amount,
          currency: 'INR',
          status: 'completed',
          purchaseId: purchaseId,
          planActivatedAt: startDate,
          planExpiresAt: endDate
        },
        user: {
          plan: updatedUser?.plan,
          planExpiresAt: updatedUser?.planExpiresAt
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to activate PRO plan' });
    }
  });

  // Get payment details for success page
  app.get('/api/payment/:paymentId', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { paymentId } = req.params;
      const payment = await Payment.findOne({ 
        _id: paymentId, 
        userId: req.user!.id 
      });
      
      if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
      }
      
      const user = await storage.getUser(req.user!.id);
      
      res.json({
        payment: {
          id: payment._id,
          amount: payment.amount,
          currency: payment.currency || 'INR',
          status: payment.status,
          purchaseId: payment.dodoPurchaseId,
          createdAt: payment.createdAt,
          subscriptionStartDate: payment.subscriptionStartDate,
          subscriptionEndDate: payment.subscriptionEndDate
        },
        user: {
          plan: user?.plan,
          planExpiresAt: user?.planExpiresAt,
          planActivatedAt: user?.planActivatedAt
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch payment details' });
    }
  });
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
      
      // Validate password strength
      if (newPassword.length < 8) {
        return res.status(400).json({ message: 'New password must be at least 8 characters long' });
      }
      
      // Check for common weak passwords
      const weakPasswords = ['password', '12345678', 'qwerty123', 'admin123'];
      if (weakPasswords.includes(newPassword.toLowerCase())) {
        return res.status(400).json({ message: 'Password is too weak' });
      }
      
      const user = await storage.getUser(req.user!.id);
      if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
        return res.status(400).json({ message: 'Current password is incorrect' });
      }
      
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUserPassword(user.email, hashedPassword);
      
      res.json({ message: 'Password changed successfully' });
    } catch (error) {
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
      
      // Validate name
      if (typeof name !== 'string' || name.length < 2 || name.length > 50) {
        return res.status(400).json({ message: 'Name must be between 2 and 50 characters' });
      }
      
      // Sanitize name (remove extra spaces, special characters)
      const sanitizedName = name.trim().replace(/[<>\"'&]/g, '');
      if (sanitizedName.length < 2) {
        return res.status(400).json({ message: 'Invalid name format' });
      }
      
      await storage.updateUserProfile(req.user!.id, { name: sanitizedName });
      res.json({ message: 'Profile updated successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });
  app.get('/api/user/payments', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const payments = await Payment.find({ userId: req.user!.id }).sort({ createdAt: -1 });
      res.json(payments);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch payments' });
    }
  });

  // === ADMIN ===
  app.get(api.admin.users.path, authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    try {
      const users = await storage.getUsers();
      
      // Remove sensitive data before sending
      const sanitizedUsers = users.map(user => ({
        _id: user._id,
        email: user.email,
        role: user.role,
        plan: user.plan,
        monthlyUsage: user.monthlyUsage,
        createdAt: user.createdAt,
        planExpiresAt: user.planExpiresAt
      }));
      res.json(sanitizedUsers);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  app.put(api.admin.updatePlan.path, authenticateToken, authorizeRole(['ADMIN']), async (req: AuthRequest, res) => {
    const { plan } = req.body;
    const userId = req.params.id;
    
    // Validate plan
    if (!plan || !['FREE', 'PRO'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan type' });
    }
    
    // Validate userId format (MongoDB ObjectId)
    if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    
    await storage.updateUserPlan(userId, plan);
    res.json({ success: true });
  });

  app.put('/api/admin/user/:id/role', authenticateToken, authorizeRole(['ADMIN']), async (req: AuthRequest, res) => {
    const { role } = req.body;
    const userId = req.params.id;
    
    // Validate role
    if (!role || !['USER', 'ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role type' });
    }
    
    // Validate userId format
    if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    
    // Prevent admin from demoting themselves
    if (userId === req.user!.id && role !== 'ADMIN') {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }
    
    await storage.updateUserRole(userId, role);
    res.json({ success: true });
  });

  app.put('/api/admin/user/:id/reset-usage', authenticateToken, authorizeRole(['ADMIN']), async (req: AuthRequest, res) => {
    const userId = req.params.id;
    
    // Validate userId format
    if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    
    await storage.resetMonthlyUsage(userId);
    res.json({ success: true });
  });

  app.delete('/api/admin/user/:id', authenticateToken, authorizeRole(['ADMIN']), async (req: AuthRequest, res) => {
    const userId = req.params.id;
    
    // Validate userId format
    if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    
    // Prevent admin from deleting themselves
    if (userId === req.user!.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
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
