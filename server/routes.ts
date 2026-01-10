import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import bcrypt from "bcryptjs";
import multer from "multer";
import crypto from "crypto";
import { docxService, fileBufferStore, paragraphMappings, paragraphStyles, documentTimestamps, cleanupExpiredDocuments } from "./docx.service";
import { authenticateToken, authorizeRole, checkPlanLimit, generateToken, type AuthRequest } from "./middleware";
import { sendOTP, generateOTP } from "./email.service";
import { OTP, Payment, User } from "./models";

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
      const adminCount = await storage.getUsers().then(users => users.filter(u => u.role === 'ADMIN').length);
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        database: {
          connected: true,
          userCount: userCount,
          adminCount: adminCount
        }
      });
    } catch (error: any) {
      res.json({
        status: 'error',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        database: {
          connected: false,
          error: error?.message || 'Unknown error'
        }
      });
    }
  });

  // Create admin user endpoint (only if no admin exists)
  app.post('/api/admin/create-first-admin', async (req, res) => {
    try {
      const { email, password, name } = req.body;

      // Input validation
      if (!email || !password || !name) {
        return res.status(400).json({ message: "Email, password, and name are required" });
      }

      // Check if any admin already exists
      const existingAdmins = await storage.getUsers().then(users => users.filter(u => u.role === 'ADMIN'));
      if (existingAdmins.length > 0) {
        return res.status(400).json({ message: "Admin user already exists" });
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

      // Check if email already exists
      const existing = await storage.getUserByEmail(email.toLowerCase().trim());
      if (existing) {
        return res.status(400).json({ message: "Email already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const adminUser = await storage.createUser({
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        name: name.trim(),
        role: 'ADMIN',
        isVerified: true
      });

      res.json({
        success: true,
        message: "Admin user created successfully",
        admin: {
          id: adminUser._id,
          email: adminUser.email,
          role: adminUser.role
        }
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to create admin user" });
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
      res.status(201).json({ token, user: { id: user._id, email: user.email, name: user.name || user.email.split('@')[0], role: user.role, plan: user.plan } });
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
      const user = await storage.createUser({
        email: input.email,
        password: hashedPassword,
        name: input.name || input.email.split('@')[0] // Ensure name is always provided
      });
      const token = generateToken({ id: user._id, email: user.email, role: user.role, plan: user.plan });

      res.status(201).json({ token, user: { id: user._id, email: user.email, name: user.name || user.email.split('@')[0], role: user.role, plan: user.plan } });
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
      res.status(200).json({ token, user: { id: user._id, email: user.email, name: user.name || user.email.split('@')[0], role: user.role, plan: user.plan } });
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
      name: user.name || user.email.split('@')[0], // Fallback to email prefix if name is missing
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
  app.post(api.docx.upload.path, authenticateToken, upload.single('file'), async (req: AuthRequest, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

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
      paragraphStyles.set(documentId, result.styleMap);
      documentTimestamps.set(documentId, Date.now());

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

  app.post(api.docx.export.path, authenticateToken, checkPlanLimit, async (req: AuthRequest, res) => {
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
        if (para.id === undefined || typeof para.text !== 'string') {
          return res.status(400).json({ message: "Invalid paragraph format" });
        }
        if (para.text.length > 10000) {
          return res.status(400).json({ message: "Paragraph too long" });
        }
        // Validate inheritStyleFrom if present
        if (para.inheritStyleFrom && typeof para.inheritStyleFrom !== 'string') {
          return res.status(400).json({ message: "Invalid inheritStyleFrom format" });
        }
      }

      const originalBuffer = fileBufferStore.get(documentId);
      const paragraphMap = paragraphMappings.get(documentId);

      if (!originalBuffer || !paragraphMap) {
        return res.status(404).json({ message: "Original document not found (session expired?)" });
      }

      const newBuffer = await docxService.rebuild(originalBuffer, paragraphs, paragraphMap);

      await storage.incrementMonthlyUsage(req.user!.id);

      // Clean up memory after successful export
      fileBufferStore.delete(documentId);
      paragraphMappings.delete(documentId);
      paragraphStyles.delete(documentId);
      documentTimestamps.delete(documentId);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="edited_${documentId}.docx"`);
      res.send(newBuffer);
    } catch (err) {
      res.status(500).json({ message: "Failed to export DOCX" });
    }
  });

  // === PAYMENT CHECKOUT SESSION ===
  app.post('/api/payment/create-checkout-session', authenticateToken, async (req: AuthRequest, res) => {
    try {
      const { user_id, plan, customer_email } = req.body;

      // Validate input
      if (!user_id || !plan || !customer_email) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Ensure user can only create session for themselves
      if (req.user!.id !== user_id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(customer_email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      const frontendUrl = process.env.FRONTEND_URL || 'https://www.docreplacer.online';
      const returnUrl = `${frontendUrl}/app/upload?payment_success=true`;
      const cancelUrl = `${frontendUrl}/pricing?cancelled=true`;

      // Try to create proper Dodo checkout session via API
      try {
        const dodoResponse = await fetch('https://api.dodopayments.com/v1/checkout-sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.DODO_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            product_cart: [{
              product_id: 'pdt_0NVX9quGOX5LINtgREm6f',
              quantity: 1
            }],
            feature_flags: {
              redirect_immediately: true
            },
            return_url: returnUrl,
            cancel_url: cancelUrl,
            customer: {
              email: customer_email,
              name: customer_email.split('@')[0]
            },
            metadata: {
              user_id: user_id,
              plan: plan,
              frontend_url: frontendUrl
            }
          })
        });

        if (dodoResponse.ok) {
          const dodoData = await dodoResponse.json();

          if (dodoData.checkout_url) {
            return res.json({
              checkout_url: dodoData.checkout_url,
              return_url: returnUrl,
              method: 'api'
            });
          }
        }

      } catch (apiError) {
        // Silent fallback to URL method
      }

      // Fallback to direct URL approach if API fails
      const baseUrl = 'https://checkout.dodopayments.com/buy/pdt_0NVX9quGOX5LINtgREm6f';
      const params = new URLSearchParams({
        quantity: '1',
        customer_email: customer_email,
        success_url: returnUrl,
        cancel_url: cancelUrl,
        return_url: returnUrl,
        // Metadata for webhook
        'metadata[user_id]': user_id,
        'metadata[plan]': plan,
        'metadata[frontend_url]': frontendUrl,
        // Enable immediate redirect
        'redirect_immediately': 'true'
      });

      const checkoutUrl = `${baseUrl}?${params.toString()}`;

      // Return the checkout URL to the frontend
      res.json({
        checkout_url: checkoutUrl,
        return_url: returnUrl,
        method: 'fallback'
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: 'Internal server error', details: errorMessage });
    }
  });

  // === PAYMENT WEBHOOK - FULL SUBSCRIPTION MANAGEMENT ===
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
        'subscription.created',
        'subscription.renewed',
        'subscription.reactivated',
        'payment.completed',
        'payment.succeeded',
        'checkout.session.completed'
      ];

      // Handle subscription update events
      const updateEvents = [
        'subscription.updated',
        'subscription.plan_changed',
        'subscription.modified'
      ];

      // Handle subscription deactivation events
      const deactivationEvents = [
        'subscription.cancelled',
        'subscription.expired',
        'subscription.failed',
        'subscription.suspended',
        'payment.failed',
        'payment.refunded'
      ];

      // Handle subscription hold/pause events
      const holdEvents = [
        'subscription.on_hold',
        'subscription.paused',
        'subscription.pending'
      ];

      // Handle trial events
      const trialEvents = [
        'subscription.trial_started',
        'subscription.trial_ending',
        'subscription.trial_ended'
      ];

      if (activationEvents.includes(type)) {
        // ✅ ACTIVATE PRO PLAN
        const { subscription_id, customer, status, next_billing_date, expires_at, metadata, amount, recurring_pre_tax_amount } = data;

        // Try to identify user first via metadata (most reliable), then email
        let user;
        let userEmail = customer?.email;

        // Method 1: Try metadata.user_id
        if (metadata?.user_id) {
          user = await storage.getUser(metadata.user_id);
        }

        // Method 2: Try email if user not found via metadata
        if (!user && userEmail) {
          const sanitizedEmail = userEmail.toLowerCase().trim();
          user = await storage.getUserByEmail(sanitizedEmail);
        }

        if (!user) {
          console.error(`[Webhook] User not found. Email: ${userEmail}, UserID: ${metadata?.user_id}`);
          return res.status(404).json({ error: 'User not found', email: userEmail, user_id: metadata?.user_id });
        }

        const sanitizedEmail = user.email; // Use the found user's email

        // Create or update payment record
        const subscriptionId = subscription_id || data.id || `dodo_${Date.now()}`;
        let paymentRecord = await storage.getPaymentByPurchaseId(subscriptionId);

        if (!paymentRecord) {
          paymentRecord = await storage.createPayment({
            userId: user._id,
            dodoPurchaseId: subscriptionId,
            productId: data.product_id || 'pro_plan',
            amount: recurring_pre_tax_amount || amount || 300,
            status: 'completed',
            customerEmail: sanitizedEmail
          });
        }

        // Calculate subscription dates
        const startDate = new Date();
        let endDate;

        if (expires_at) {
          endDate = new Date(expires_at);
        } else if (next_billing_date) {
          endDate = new Date(next_billing_date);
        } else {
          // Default to 30 days from now
          endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        }

        // Update payment and user records
        await storage.updatePaymentStatus(subscriptionId, 'completed', { startDate, endDate });
        await storage.updateUserPlan(user._id, 'PRO');

        // Set plan expiration date
        await storage.updateUserPlanExpiration(user._id, endDate);

        const frontendUrl = metadata?.frontend_url || process.env.FRONTEND_URL || 'https://www.docreplacer.online';
        const redirectUrl = `${frontendUrl}/app/upload?payment_success=true&subscription_id=${subscriptionId}`;

        res.json({
          success: true,
          action: 'plan_activated',
          redirect_url: redirectUrl,
          message: `PRO plan activated via ${type}`,
          subscription_id: subscriptionId,
          subscription_end_date: endDate.toISOString(),
          user_email: sanitizedEmail
        });

      } else if (updateEvents.includes(type)) {
        // 🔄 UPDATE SUBSCRIPTION
        const { subscription_id, customer, status, next_billing_date, expires_at, amount, recurring_pre_tax_amount } = data;

        if (!customer?.email) {
          return res.status(400).json({ error: 'Missing customer email' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customer.email)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }

        const sanitizedEmail = customer.email.toLowerCase().trim();
        const user = await storage.getUserByEmail(sanitizedEmail);
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Update subscription details if subscription_id provided
        if (subscription_id) {
          const startDate = new Date();
          let endDate;

          if (expires_at) {
            endDate = new Date(expires_at);
          } else if (next_billing_date) {
            endDate = new Date(next_billing_date);
          } else {
            endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
          }

          await storage.updatePaymentStatus(subscription_id, 'completed', { startDate, endDate });
          await storage.updateUserPlanExpiration(user._id, endDate);

          // Update payment amount if provided
          if (recurring_pre_tax_amount || amount) {
            await storage.updatePaymentAmount(subscription_id, recurring_pre_tax_amount || amount);
          }
        }

        // Keep PRO plan active if subscription is active
        if (status === 'active' || status === 'pending' || !status) {
          await storage.updateUserPlan(user._id, 'PRO');
        }

        res.json({
          success: true,
          action: 'subscription_updated',
          message: `Subscription updated via ${type}`,
          user_email: sanitizedEmail
        });

      } else if (deactivationEvents.includes(type)) {
        // ❌ DEACTIVATE PRO PLAN
        const { subscription_id, customer, reason } = data;

        if (!customer?.email) {
          return res.status(400).json({ error: 'Missing customer email' });
        }

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
          const cancelStatus = type.includes('failed') ? 'failed' :
            type.includes('refunded') ? 'refunded' : 'cancelled';

          await storage.updatePaymentStatus(subscription_id, cancelStatus, {
            startDate: new Date(),
            endDate: new Date() // Expire immediately
          });
        }

        // Downgrade to FREE plan
        await storage.updateUserPlan(user._id, 'FREE');
        await storage.updateUserPlanExpiration(user._id, new Date()); // Expire immediately

        res.json({
          success: true,
          action: 'plan_deactivated',
          message: `PRO plan deactivated via ${type}`,
          reason: reason || type,
          user_email: sanitizedEmail
        });

      } else if (holdEvents.includes(type)) {
        // ⏸️ HANDLE SUBSCRIPTION ON HOLD
        const { subscription_id, customer, next_billing_date, expires_at } = data;

        if (!customer?.email) {
          return res.status(400).json({ error: 'Missing customer email' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customer.email)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }

        const sanitizedEmail = customer.email.toLowerCase().trim();
        const user = await storage.getUserByEmail(sanitizedEmail);
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Update payment status but keep plan active temporarily
        if (subscription_id) {
          await storage.updatePaymentStatus(subscription_id, 'on_hold');

          // If there's an expiration date, respect it
          if (expires_at) {
            await storage.updateUserPlanExpiration(user._id, new Date(expires_at));
          } else if (next_billing_date) {
            await storage.updateUserPlanExpiration(user._id, new Date(next_billing_date));
          }
        }

        // Keep PRO plan active during hold period
        // Plan will expire naturally based on expiration date

        res.json({
          success: true,
          action: 'subscription_on_hold',
          message: `Subscription on hold via ${type}`,
          user_email: sanitizedEmail
        });

      } else if (trialEvents.includes(type)) {
        // 🆓 HANDLE TRIAL EVENTS
        const { subscription_id, customer, trial_end_date, next_billing_date } = data;

        if (!customer?.email) {
          return res.status(400).json({ error: 'Missing customer email' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customer.email)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }

        const sanitizedEmail = customer.email.toLowerCase().trim();
        const user = await storage.getUserByEmail(sanitizedEmail);
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        if (type === 'subscription.trial_started') {
          // Activate PRO during trial
          await storage.updateUserPlan(user._id, 'PRO');

          if (trial_end_date) {
            await storage.updateUserPlanExpiration(user._id, new Date(trial_end_date));
          }

          if (subscription_id) {
            await storage.updatePaymentStatus(subscription_id, 'trial');
          }

        } else if (type === 'subscription.trial_ended') {
          // Check if user converted to paid subscription
          if (next_billing_date) {
            // Trial converted to paid - keep PRO
            await storage.updateUserPlan(user._id, 'PRO');
            await storage.updateUserPlanExpiration(user._id, new Date(next_billing_date));
          } else {
            // Trial ended without conversion - downgrade to FREE
            await storage.updateUserPlan(user._id, 'FREE');
            await storage.updateUserPlanExpiration(user._id, new Date());
          }
        }

        res.json({
          success: true,
          action: 'trial_managed',
          message: `Trial event handled: ${type}`,
          user_email: sanitizedEmail
        });

      } else {
        // 📝 UNSUPPORTED EVENT TYPE
        res.json({
          success: true,
          action: 'event_logged',
          message: `Received event: ${type}`,
          note: 'Event logged but no action taken'
        });
      }
    } catch (error) {
      res.status(500).json({
        error: 'Webhook processing failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
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
      paragraphStyles.delete(documentId);
      documentTimestamps.delete(documentId);

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
  app.get(api.admin.users.path, authenticateToken, authorizeRole(['ADMIN']), async (req: AuthRequest, res) => {
    try {
      const users = await storage.getUsers();

      // Remove sensitive data before sending
      const sanitizedUsers = users.map(user => ({
        _id: user._id,
        email: user.email,
        name: user.name || user.email.split('@')[0], // Fallback for users without names
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

  // Migration endpoint to fix users without names
  app.post('/api/admin/fix-user-names', authenticateToken, authorizeRole(['ADMIN']), async (req: AuthRequest, res) => {
    try {
      const users = await storage.getUsers();
      let updatedCount = 0;

      for (const user of users) {
        if (!user.name || user.name.trim() === '') {
          const defaultName = user.email.split('@')[0];
          await User.findByIdAndUpdate(user._id, { name: defaultName });
          updatedCount++;
        }
      }

      res.json({ message: `Updated ${updatedCount} users with missing names` });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fix user names' });
    }
  });

  // Admin memory management endpoints
  app.get('/api/admin/memory-status', authenticateToken, authorizeRole(['ADMIN']), async (req: AuthRequest, res) => {
    try {
      const memoryStatus = {
        documentsInMemory: fileBufferStore.size,
        paragraphMappings: paragraphMappings.size,
        paragraphStyles: paragraphStyles.size,
        documentTimestamps: documentTimestamps.size,
        oldestDocument: documentTimestamps.size > 0 ? Math.min(...Array.from(documentTimestamps.values())) : null,
        newestDocument: documentTimestamps.size > 0 ? Math.max(...Array.from(documentTimestamps.values())) : null,
        memoryUsage: process.memoryUsage()
      };

      res.json(memoryStatus);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get memory status' });
    }
  });

  app.post('/api/admin/cleanup-memory', authenticateToken, authorizeRole(['ADMIN']), async (req: AuthRequest, res) => {
    try {
      const beforeCount = fileBufferStore.size;
      cleanupExpiredDocuments();
      const afterCount = fileBufferStore.size;
      const cleanedUp = beforeCount - afterCount;

      res.json({
        success: true,
        message: `Cleaned up ${cleanedUp} expired documents`,
        documentsRemaining: afterCount
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to cleanup memory' });
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
