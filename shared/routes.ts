import { z } from 'zod';
import { insertUserSchema } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
  forbidden: z.object({
    message: z.string(),
  }),
  serverError: z.object({
    message: z.string(),
  }),
};

export const api = {
  auth: {
    register: {
      method: 'POST' as const,
      path: '/api/auth/register',
      input: insertUserSchema,
      responses: {
        201: z.object({ token: z.string(), user: z.any() }),
        400: errorSchemas.validation,
      },
    },
    login: {
      method: 'POST' as const,
      path: '/api/auth/login',
      input: z.object({ email: z.string(), password: z.string() }),
      responses: {
        200: z.object({ token: z.string(), user: z.any() }),
        401: errorSchemas.unauthorized,
      },
    },
    me: {
      method: 'GET' as const,
      path: '/api/user/me',
      responses: {
        200: z.any(),
        401: errorSchemas.unauthorized,
      },
    },
  },
  docx: {
    upload: {
      method: 'POST' as const,
      path: '/api/upload',
      // input is multipart/form-data
      responses: {
        200: z.object({ 
          documentId: z.string(), 
          paragraphs: z.array(z.object({
            id: z.string(),
            text: z.string(),
          })) 
        }),
        400: errorSchemas.validation,
        403: errorSchemas.forbidden, // Plan limit
      },
    },
    export: {
      method: 'POST' as const,
      path: '/api/export',
      input: z.object({
        // We might need to send the original file ID if we stored it,
        // or if we're stateless, we might need to send the whole structure.
        // Given the prompt "Rebuild DOCX by modifying word/document.xml", 
        // we likely need the original file to be available. 
        // We'll assume the documentId maps to a stored file (or in memory).
        documentId: z.string(),
        paragraphs: z.array(z.object({
           id: z.string(),
           text: z.string(),
        }))
      }),
      responses: {
        200: z.any(), // File stream
        404: errorSchemas.notFound,
      },
    },
  },
  payment: {
    createOrder: {
      method: 'POST' as const,
      path: '/api/payment/create-order',
      input: z.object({ amount: z.number() }), 
      responses: {
        200: z.object({ orderId: z.string(), amount: z.number(), currency: z.string() }),
        401: errorSchemas.unauthorized,
      },
    },
    verify: {
      method: 'POST' as const,
      path: '/api/payment/verify',
      input: z.object({
        razorpay_order_id: z.string(),
        razorpay_payment_id: z.string(),
        razorpay_signature: z.string(),
      }),
      responses: {
        200: z.object({ success: z.boolean() }),
        400: errorSchemas.validation,
      },
    },
    history: {
      method: 'GET' as const,
      path: '/api/payment/history',
      responses: {
        200: z.array(z.any()),
        401: errorSchemas.unauthorized,
      },
    }
  },
  admin: {
    users: {
      method: 'GET' as const,
      path: '/api/admin/users',
      responses: {
        200: z.array(z.any()),
        403: errorSchemas.forbidden,
      },
    },
    updatePlan: {
      method: 'PUT' as const,
      path: '/api/admin/user/:id/plan',
      input: z.object({ plan: z.enum(['FREE', 'PRO']) }),
      responses: {
        200: z.any(),
        403: errorSchemas.forbidden,
      },
    },
    payments: {
      method: 'GET' as const,
      path: '/api/admin/payments',
      responses: {
        200: z.array(z.any()),
        403: errorSchemas.forbidden,
      },
    }
  }
};
