import mongoose from "mongoose";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export async function connectDB() {
  try {
    await mongoose.connect(process.env.DATABASE_URL!);
  } catch (error) {
    process.exit(1);
  }
}

export { mongoose };
