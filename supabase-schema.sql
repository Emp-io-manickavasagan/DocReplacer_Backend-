-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN', 'VIP')),
  plan VARCHAR(50) DEFAULT 'FREE' CHECK (plan IN ('FREE', 'PRO')),
  plan_activated_at TIMESTAMPTZ DEFAULT NOW(),
  plan_expires_at TIMESTAMPTZ,
  monthly_usage INTEGER DEFAULT 0,
  last_usage_reset TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  cancel_at_period_end BOOLEAN DEFAULT FALSE
);

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  document_id VARCHAR(255) NOT NULL,
  original_content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create payments table
CREATE TABLE IF NOT EXISTS payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  dodo_purchase_id VARCHAR(255) UNIQUE NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  amount INTEGER NOT NULL,
  currency VARCHAR(10) DEFAULT 'INR',
  status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  payment_method VARCHAR(100),
  customer_email VARCHAR(255),
  subscription_start_date TIMESTAMPTZ,
  subscription_end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create otps table
CREATE TABLE IF NOT EXISTS otps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  otp VARCHAR(10) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  user_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create guest_usage table
CREATE TABLE IF NOT EXISTS guest_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  browser_id VARCHAR(255) UNIQUE NOT NULL,
  count INTEGER DEFAULT 0,
  documents TEXT[] DEFAULT '{}',
  first_used TIMESTAMPTZ DEFAULT NOW(),
  last_used TIMESTAMPTZ DEFAULT NOW()
);

-- Create reviews table
CREATE TABLE IF NOT EXISTS reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id VARCHAR(255) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  browser_id VARCHAR(255),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  reasons TEXT[] DEFAULT '{}',
  feedback TEXT DEFAULT '',
  user_type VARCHAR(50) NOT NULL CHECK (user_type IN ('GUEST', 'FREE', 'PRO', 'VIP')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_document_id ON documents(document_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_dodo_purchase_id ON payments(dodo_purchase_id);
CREATE INDEX IF NOT EXISTS idx_otps_email_otp ON otps(email, otp);
CREATE INDEX IF NOT EXISTS idx_guest_usage_browser_id ON guest_usage(browser_id);
CREATE INDEX IF NOT EXISTS idx_reviews_document_id ON reviews(document_id);

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (these allow service role to access all data)
CREATE POLICY "Service role can access all users" ON users FOR ALL USING (true);
CREATE POLICY "Service role can access all documents" ON documents FOR ALL USING (true);
CREATE POLICY "Service role can access all payments" ON payments FOR ALL USING (true);
CREATE POLICY "Service role can access all otps" ON otps FOR ALL USING (true);
CREATE POLICY "Service role can access all guest_usage" ON guest_usage FOR ALL USING (true);
CREATE POLICY "Service role can access all reviews" ON reviews FOR ALL USING (true);