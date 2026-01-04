import nodemailer from 'nodemailer';

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
  }
});

export const sendOTP = async (email: string, otp: string) => {
  try {
    console.log('=== EMAIL DEBUG ===');
    console.log('Sending OTP to:', email);
    console.log('OTP Code:', otp);
    console.log('Email User:', process.env.EMAIL_USER);
    console.log('Email Pass Set:', !!process.env.EMAIL_PASS);
    console.log('===================');
    
    // For development: Show OTP in console
    if (process.env.NODE_ENV === 'development') {
      console.log(`\n🔐 OTP for ${email}: ${otp}\n`);
      return { messageId: 'dev-mode' };
    }
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Email Verification - OTP',
      html: `
        <h2>Email Verification</h2>
        <p>Your OTP for account verification is: <strong>${otp}</strong></p>
        <p>This OTP will expire in 10 minutes.</p>
      `,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', result.messageId);
    return result;
  } catch (error) {
    console.error('Email sending failed:', error);
    
    // Development fallback: show OTP in console
    if (process.env.NODE_ENV === 'development') {
      console.log(`\n🔐 OTP for ${email}: ${otp} (Email failed, check console)\n`);
      return { messageId: 'dev-fallback' };
    }
    
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};