import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { storage } from "./storage";

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_jwt_key_123";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    plan: string;
  };
  isGuest?: boolean;
  browserId?: string;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Unauthorized" });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ message: "Forbidden" });
    }
    req.user = user;
    next();
  });
};

export const authenticateTokenOrGuest = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const browserId = req.headers['x-browser-id'] as string;

  if (token) {
    // Try to authenticate with token
    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (!err) {
        req.user = user;
        req.isGuest = false;
      } else {
        // Token invalid, treat as guest
        req.isGuest = true;
        req.browserId = browserId;
      }
      next();
    });
  } else {
    // No token, treat as guest
    req.isGuest = true;
    req.browserId = browserId;
    next();
  }
};

export const authorizeRole = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };
};

export const checkPlanLimit = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // Handle guest users
  if (req.isGuest) {
    const browserId = req.browserId;
    if (!browserId) {
      return res.status(400).json({ message: "Browser ID required for guest users" });
    }

    const canUse = await storage.canGuestUse(browserId);
    if (!canUse) {
      const guestUsage = await storage.getGuestUsage(browserId);
      return res.status(403).json({ 
        message: "Guest limit reached. Please login to get 3 free edits per month.",
        isGuest: true,
        guestUsage: guestUsage?.count || 3
      });
    }
    
    return next();
  }

  // Handle authenticated users
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = await storage.getUser(req.user.id);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const now = new Date();
  const planActivatedAt = user.planActivatedAt || user.createdAt;
  const daysSincePlanActivation = Math.floor((now.getTime() - planActivatedAt.getTime()) / (1000 * 60 * 60 * 24));

  // Check if 30 days have passed since plan activation
  if (daysSincePlanActivation >= 30) {
    // Reset usage and update plan activation date
    await storage.resetMonthlyUsage(user._id);

    // If PRO plan, downgrade to FREE after 30 days (subscription expired)
    if (user.plan === 'PRO') {
      await storage.updateUserPlan(user._id, 'FREE');
      await storage.updatePlanActivationDate(user._id, now);
    } else {
      // For FREE users, just reset the cycle
      await storage.updatePlanActivationDate(user._id, now);
    }

    // Refresh user data
    const updatedUser = await storage.getUser(req.user.id);
    if (updatedUser) {
      user.monthlyUsage = updatedUser.monthlyUsage;
      user.plan = updatedUser.plan;
    }
  }

  // Check for VIP role - VIPs have unlimited access and no time limits
  if (user.role === 'VIP') {
    return next();
  }

  const limits = {
    'FREE': 3,
    'PRO': 30 // 30 documents per month for PRO users
  };

  const limit = limits[user.plan as keyof typeof limits] || 0;

  if (user.monthlyUsage >= limit) {
    // Calculate days remaining until reset
    const planActivatedAt = user.planActivatedAt || user.createdAt;
    const nextResetDate = new Date(planActivatedAt.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days from activation
    const daysUntilReset = Math.ceil((nextResetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    const message = user.plan === 'FREE' 
      ? 'Please upgrade to PRO for 30 documents per month.'
      : `Sorry, limit reached. Your usage will be reset in ${daysUntilReset} day${daysUntilReset !== 1 ? 's' : ''}.`;
    
    return res.status(403).json({ 
      message: `Monthly plan limit exceeded. ${message}`,
      daysUntilReset: user.plan === 'PRO' ? daysUntilReset : null,
      resetDate: user.plan === 'PRO' ? nextResetDate.toISOString() : null
    });
  }

  next();
};

export const generateToken = (user: { id: string; email: string; role: string; plan: string }) => {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '30d' });
};
