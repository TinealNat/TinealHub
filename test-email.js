const nodemailer = require('nodemailer');
require('dotenv').config();

async function testEmail() {
    console.log('Testing email with:');
    console.log('User:', process.env.EMAIL_USER);
    console.log('Password length:', process.env.EMAIL_PASS ? process.env.EMAIL_PASS.length : 0);
    
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
    
    try {
        const info = await transporter.sendMail({
            from: `"TINEAL HUB" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER, // Send to yourself
            subject: 'Test Email from TINEAL HUB',
            html: '<h1>Test Successful!</h1><p>Your email is working!</p>'
        });
        console.log('✅ Email sent!', info.messageId);
    } catch (error) {
        console.error('❌ Failed:', error.message);
        if (error.code === 'EAUTH') {
            console.log('   Authentication failed. Check your email and app password.');
        }
    }
}

testEmail();