import { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

// Create DOMPurify instance for server-side sanitization
const window = new JSDOM('').window;
const purify = DOMPurify(window);

// Input sanitization function
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') return '';
  
  // Remove HTML tags and potentially dangerous content
  const sanitized = purify.sanitize(input, { 
    ALLOWED_TAGS: [], // No HTML tags allowed
    ALLOWED_ATTR: [] // No attributes allowed
  });
  
  // Additional sanitization for common XSS patterns
  return sanitized
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, '') // Remove event handlers
    .replace(/data:/gi, '') // Remove data: protocol
    .trim();
}

// Validation middleware factory
export function validateAndSanitize(validations: any[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Run validations
    await Promise.all(validations.map(validation => validation.run(req)));
    
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array().map(err => ({
          field: err.type === 'field' ? err.path : 'unknown',
          message: err.msg
        }))
      });
    }
    
    // Sanitize string inputs in body
    if (req.body && typeof req.body === 'object') {
      sanitizeObject(req.body);
    }
    
    // Sanitize query parameters
    if (req.query && typeof req.query === 'object') {
      sanitizeObject(req.query);
    }
    
    next();
  };
}

// Recursively sanitize object properties
function sanitizeObject(obj: any): void {
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (typeof obj[key] === 'string') {
        obj[key] = sanitizeInput(obj[key]);
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  }
}

// Common validation rules
export const validationRules = {
  email: body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email format')
    .isLength({ max: 255 })
    .withMessage('Email too long'),
    
  password: body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be 8-128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
    
  name: body('name')
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be 1-100 characters')
    .matches(/^[a-zA-Z0-9\s\-_.'àáâäãåąčćęèéêëėįìíîïłńòóôöõøùúûüųūÿýżźñçčšžÀÁÂÄÃÅĄĆČĖĘÈÉÊËÌÍÎÏĮŁŃÒÓÔÖÕØÙÚÛÜŲŪŸÝŻŹÑßÇŒÆČŠŽ∂ð]+$/)
    .withMessage('Name contains invalid characters'),
    
  uuid: param('id')
    .isUUID()
    .withMessage('Invalid ID format'),
    
  documentId: body('documentId')
    .isUUID()
    .withMessage('Invalid document ID format'),
    
  rating: body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
    
  otp: body('otp')
    .isNumeric()
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be 6 digits'),
    
  plan: body('plan')
    .isIn(['FREE', 'PRO'])
    .withMessage('Invalid plan type'),
    
  role: body('role')
    .isIn(['USER', 'ADMIN', 'VIP'])
    .withMessage('Invalid role type'),
    
  feedback: body('feedback')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Feedback too long'),
    
  reasons: body('reasons')
    .optional()
    .isArray({ max: 10 })
    .withMessage('Too many reasons'),
    
  paragraphs: body('paragraphs')
    .isArray({ max: 1000 })
    .withMessage('Too many paragraphs')
    .custom((paragraphs) => {
      if (!Array.isArray(paragraphs)) return false;
      
      for (const para of paragraphs) {
        if (!para || typeof para !== 'object') return false;
        if (typeof para.text !== 'string' || para.text.length > 10000) return false;
        if (para.id !== null && typeof para.id !== 'string') return false;
      }
      return true;
    })
    .withMessage('Invalid paragraph format')
};

// SQL Injection prevention (though we use Supabase which has built-in protection)
export function preventSQLInjection(input: string): string {
  if (typeof input !== 'string') return '';
  
  // Remove common SQL injection patterns
  return input
    .replace(/['";\\]/g, '') // Remove quotes and backslashes
    .replace(/--/g, '') // Remove SQL comments
    .replace(/\/\*/g, '') // Remove block comment start
    .replace(/\*\//g, '') // Remove block comment end
    .replace(/\bUNION\b/gi, '') // Remove UNION
    .replace(/\bSELECT\b/gi, '') // Remove SELECT
    .replace(/\bINSERT\b/gi, '') // Remove INSERT
    .replace(/\bUPDATE\b/gi, '') // Remove UPDATE
    .replace(/\bDELETE\b/gi, '') // Remove DELETE
    .replace(/\bDROP\b/gi, '') // Remove DROP
    .replace(/\bCREATE\b/gi, '') // Remove CREATE
    .replace(/\bALTER\b/gi, '') // Remove ALTER
    .replace(/\bEXEC\b/gi, '') // Remove EXEC
    .trim();
}

// Rate limiting for sensitive operations
export const sensitiveOperationLimiter = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
};

// File upload security
export function validateFileUpload(req: Request, res: Response, next: NextFunction) {
  if (!req.file) {
    return next();
  }
  
  const file = req.file;
  
  // Validate file type
  const allowedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return res.status(400).json({ message: 'Invalid file type' });
  }
  
  // Validate file size (10MB max)
  if (file.size > 10 * 1024 * 1024) {
    return res.status(400).json({ message: 'File too large' });
  }
  
  // Validate filename
  const filename = file.originalname;
  if (filename.length > 255) {
    return res.status(400).json({ message: 'Filename too long' });
  }
  
  // Check for path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ message: 'Invalid filename' });
  }
  
  // Check for dangerous characters
  if (/[\x00-\x1f\x7f]/.test(filename)) {
    return res.status(400).json({ message: 'Invalid filename characters' });
  }
  
  next();
}

// CSRF protection for state-changing operations
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Skip CSRF for GET requests and API endpoints with proper authentication
  if (req.method === 'GET' || req.path.startsWith('/api/')) {
    return next();
  }
  
  // For non-API routes, ensure proper origin
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://www.docreplacer.online',
    'https://docreplacer.online'
  ];
  
  if (!origin || !allowedOrigins.includes(origin)) {
    return res.status(403).json({ message: 'Invalid origin' });
  }
  
  next();
}