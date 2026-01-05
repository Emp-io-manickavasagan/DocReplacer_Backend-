import express, { type Express } from "express";

export function serveStatic(app: Express) {
  // API-only backend - no static files to serve
  app.get('/', (_req, res) => {
    res.json({ message: 'DocReplacer API is running' });
  });
}
