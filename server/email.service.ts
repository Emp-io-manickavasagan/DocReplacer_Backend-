import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  debug: true,
  logger: true
});

export const sendOTP = async (email: string, otp: string) => {
  try {
    console.log('=== EMAIL DEBUG ===');
    console.log('Sending OTP to:', email);
    console.log('OTP Code:', otp);
    console.log('Email User:', process.env.EMAIL_USER);
    console.log('Email Pass Set:', !!process.env.EMAIL_PASS);
    console.log('Email Pass Length:', process.env.EMAIL_PASS?.length);
    console.log('NODE_ENV:', process.env.NODE_ENV);
    console.log('===================');
    
    // Always show OTP in console for production debugging
    console.log(`\n🔐 OTP for ${email}: ${otp}\n`);
    
    // Test transporter connection
    console.log('Testing email connection...');
    try {
      await transporter.verify();
      console.log('✅ Email connection verified');
    } catch (verifyError) {
      console.error('❌ Email connection failed:', verifyError);
      throw verifyError;
    }
    
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
          <p>If you didn't request this verification, please ignore this email.</p>
          <hr style="margin: 30px 0;">
          <p style="color: #666; font-size: 12px;">DocReplacer - Online DOCX Editor</p>
        </div>
      `,
    };

    console.log('Sending email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });
    
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully to:', email, 'MessageID:', result.messageId);
    return result;
  } catch (error) {
    console.error('❌ Email sending failed:', error);
    console.error('Error details:', {
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode
    });
    
    // Try to send email anyway - throw error to trigger retry
    throw new Error(`Failed to send OTP email: ${error.message}`);
  }
};

export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};