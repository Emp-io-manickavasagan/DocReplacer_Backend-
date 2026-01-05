import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  debug: false,
  logger: false
});

export const sendOTP = async (email: string, otp: string) => {
  try {
    console.log(`Sending OTP ${otp} to ${email}`);
    
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
    console.error('Email sending failed:', error.message);
    throw new Error(`Failed to send OTP email: ${error.message}`);
  }
};

export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};