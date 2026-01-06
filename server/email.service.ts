import { Resend } from 'resend';

if (!process.env.RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY environment variable is required');
}

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendOTP = async (email: string, otp: string) => {
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

    console.log('Email sent successfully via Resend:', data?.id);
    return data;
  } catch (error) {
    console.error('Email sending failed:', error.message);
    throw new Error(`Failed to send OTP email: ${error.message}`);
  }
};

export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};