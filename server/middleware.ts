import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { storage } from "./storage";

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_jwt_key_123";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: string;
    plan: string;
  };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Unauthorized" });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ message: "Forbidden" });
    req.user = user;
    next();
  });
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
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });

  const user = await storage.getUser(req.user.id);
  if (!user) return res.status(404).json({ message: "User not found" });

  // Reset usage if needed (simple check for now, ideally verified on login/daily job)
  const now = new Date();
  const lastReset = user.lastUsageReset ? new Date(user.lastUsageReset) : new Date(0);
  if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
    await storage.resetMonthlyUsage(user.id);
    user.monthlyUsage = 0;
  }

  const limits = {
    'FREE': 3,
    'PRO': 30
  };
  
  const limit = limits[user.plan as keyof typeof limits] || 0;

  if (user.monthlyUsage >= limit) {
    return res.status(403).json({ message: "Monthly plan limit exceeded. Please upgrade to PRO." });
  }

  next();
};

export const generateToken = (user: { id: number; email: string; role: string; plan: string }) => {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '1h' });
};
