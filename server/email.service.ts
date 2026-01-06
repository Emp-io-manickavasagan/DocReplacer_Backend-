import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 'your_resend_api_key_here' 
  ? new Resend(process.env.RESEND_API_KEY) 
  : null;

export const sendOTP = async (email: string, otp: string) => {
  // If Resend is not configured, just log the OTP
  if (!resend) {
    return { id: 'console-fallback' };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'DocReplacer <noreply@docreplacer.online>',
      to: [email],
      subject: 'DocReplacer - Email Verification OTP',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #06B6D4;">DocReplacer - Email Verification</h2>
          <p>Your OTP for account verification is:</p>
          <div style="background: #f0f9ff; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #06B6D4; font-size: 32px; margin: 0;">${otp}</h1>
          </div>
          <p>This OTP will expire in 10 minutes.</p>
          <p>If you didn't request this verification, please ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      throw new Error(`Resend error: ${error.message}`);
    }

    return data;
  } catch (error) {
    throw new Error(`Failed to send OTP email: ${error.message}`);
  }
};

export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};