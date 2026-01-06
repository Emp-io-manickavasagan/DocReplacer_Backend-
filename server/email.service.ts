import nodemailer from 'nodemailer';

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  throw new Error('EMAIL_USER and EMAIL_PASS environment variables are required');
}

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 60000,
  greetingTimeout: 30000,
  socketTimeout: 60000
});

export const sendOTP = async (email: string, otp: string, retries = 2) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const mailOptions = {
        from: `"DocReplacer" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'DocReplacer - Email Verification OTP',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #06B6D4;">DocReplacer - Email Verification</h2>
            <p>Your OTP for account verification is:</p>
            <div style="background: #f0f9ff; padding: 20px; text-align: center; margin: 20px 0;">
              <h1 style="color: #06B6D4; font-size: 32px; margin: 0;">${otp}</h1>
            </div>
            <p>This OTP will expire in 10 minutes.</p>
          </div>
        `,
      };
      
      const result = await transporter.sendMail(mailOptions);
      console.log('Email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error(`Email attempt ${attempt} failed:`, error.message);
      if (attempt === retries) {
        throw new Error(`Failed to send OTP email after ${retries} attempts: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
};

export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};