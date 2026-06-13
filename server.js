const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============ PRODUCTION BASE URL ============
// Use environment variable or default to Render URL
const BASE_URL = process.env.BASE_URL || 'https://tinealhub.onrender.com';

// Admin credentials
const ADMIN_USERNAME = 'tinealadmin';
const ADMIN_PASSWORD = 'TinealHub2024!';

// Email transporter setup
let transporter = null;

console.log('🚀 TINEAL HUB Starting...');
console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`📍 Base URL: ${BASE_URL}`);
console.log('📧 Email Configuration Check:');
console.log(`   EMAIL_USER: ${process.env.EMAIL_USER ? 'Set to ' + process.env.EMAIL_USER : 'Not set'}`);
console.log(`   EMAIL_PASS: ${process.env.EMAIL_PASS ? 'Set (length: ' + process.env.EMAIL_PASS.length + ')' : 'Not set'}`);

// Check if email should be configured
const isEmailConfigured = process.env.EMAIL_USER && 
                         process.env.EMAIL_USER !== 'your_email@gmail.com' && 
                         process.env.EMAIL_PASS && 
                         process.env.EMAIL_PASS !== 'your_password' &&
                         process.env.EMAIL_PASS !== 'your_16_character_app_password_here';

if (isEmailConfigured) {
    try {
        transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.EMAIL_PORT) || 587,
            secure: false,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
        console.log('✅ Email transporter initialized successfully');
    } catch (error) {
        console.log('⚠️ Email transporter error:', error.message);
        transporter = null;
    }
} else {
    console.log('⚠️ Email not configured - will log to console only');
}

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Serve delivery files
app.use('/deliveries', express.static(path.join(__dirname, 'public', 'deliveries')));

// Database file
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// Initialize orders file
if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2));
}

// Read orders with caching
let ordersCache = null;
let lastCacheTime = 0;
const CACHE_TTL = 5000;

function getOrders() {
    const now = Date.now();
    if (ordersCache && (now - lastCacheTime) < CACHE_TTL) {
        return ordersCache;
    }
    const data = fs.readFileSync(ORDERS_FILE);
    ordersCache = JSON.parse(data);
    lastCacheTime = now;
    return ordersCache;
}

function saveOrders(orders) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
    ordersCache = orders;
    lastCacheTime = Date.now();
}

// Authentication middleware
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const base64Credentials = authHeader.split(' ')[1];
        const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
        const [username, password] = credentials.split(':');
        
        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            next();
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(401).json({ error: 'Invalid authentication' });
    }
}

// Send SMS via Arkesel
async function sendSMS(phoneNumber, message) {
    let cleanPhone = phoneNumber.toString().replace(/\D/g, '');
    
    if (cleanPhone.startsWith('0')) {
        cleanPhone = cleanPhone.substring(1);
    }
    if (!cleanPhone.startsWith('233')) {
        cleanPhone = '233' + cleanPhone;
    }
    
    const encodedMessage = encodeURIComponent(message);
    const smsUrl = `https://sms.arkesel.com/sms/api?action=send-sms&api_key=${process.env.ARKESEL_API_KEY}&to=${cleanPhone}&from=${process.env.ARKESEL_SENDER_ID}&sms=${encodedMessage}`;
    
    console.log('\n📱 SMS SENT:');
    console.log(`To: ${cleanPhone}`);
    console.log(`Message: ${message}`);
    console.log('----------------------------------------\n');
    
    if (!process.env.ARKESEL_API_KEY || process.env.ARKESEL_API_KEY === 'your_arkesel_api_key_here') {
        console.log('⚠️ SMS logged only (no API key)');
        return true;
    }
    
    try {
        const response = await axios.get(smsUrl, { timeout: 30000 });
        console.log(`✅ SMS delivered: ${response.data}\n`);
        return true;
    } catch (error) {
        console.log(`⚠️ SMS error: ${error.message}\n`);
        return true;
    }
}

// Send Email
async function sendEmail(to, subject, htmlContent) {
    console.log(`\n📧 Sending email to: ${to}`);
    console.log(`Subject: ${subject}`);
    
    // If email not configured, just log
    if (!transporter) {
        console.log('⚠️ Email not configured. Would have sent:');
        console.log('----------------------------------------');
        console.log(htmlContent.substring(0, 500));
        console.log('----------------------------------------\n');
        return true;
    }
    
    // Validate email address
    if (!to || to === 'undefined' || to === 'null' || !to.includes('@')) {
        console.log('❌ Invalid email address:', to);
        console.log('----------------------------------------\n');
        return false;
    }
    
    try {
        const mailOptions = {
            from: process.env.EMAIL_FROM || `"TINEAL HUB" <${process.env.EMAIL_USER}>`,
            to: to,
            subject: subject,
            html: htmlContent
        };
        
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent successfully!`);
        console.log(`   Message ID: ${info.messageId}`);
        console.log(`   To: ${to}`);
        console.log('----------------------------------------\n');
        return true;
    } catch (error) {
        console.error('❌ Email failed:', error.message);
        if (error.code === 'EAUTH') {
            console.error('   Authentication failed. Check your app password.');
        }
        console.log('----------------------------------------\n');
        return false;
    }
}

// ============ TEST EMAIL ENDPOINT ============
app.post('/api/test-email', requireAuth, async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.json({ success: false, error: 'Email address required' });
    }
    
    console.log(`\n📧 TEST EMAIL requested to: ${email}`);
    
    const testHtml = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Arial, sans-serif;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
                <div style="text-align: center; margin-bottom: 20px;">
                    <h1 style="color: #1a1a2e; margin: 0;">TINEAL HUB</h1>
                    <p style="color: #666; margin: 5px 0;">Creative Tech + Connectivity</p>
                </div>
                <h2 style="color: #1a1a2e;">Test Email</h2>
                <p>If you received this email, your email configuration is working correctly!</p>
                <p>This means customers will receive email notifications when their orders are updated.</p>
                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                <p style="font-size: 0.8rem; color: #666; text-align: center;">TINEAL HUB - Creative Tech + Connectivity</p>
            </div>
        </body>
        </html>
    `;
    
    const result = await sendEmail(email, 'TINEAL HUB - Email Test', testHtml);
    res.json({ success: result, message: result ? 'Email sent successfully! Check your inbox/spam.' : 'Failed to send email. Check server logs.' });
});

// ============ DEBUG ENDPOINT ============
app.get('/api/debug-order/:id', requireAuth, (req, res) => {
    const orders = getOrders();
    const order = orders.find(o => o.id === req.params.id);
    if (order) {
        res.json({
            id: order.id,
            email: order.email,
            status: order.status,
            hasEmail: !!order.email,
            emailValid: order.email && order.email.includes('@')
        });
    } else {
        res.json({ error: 'Order not found' });
    }
});

// ============ API: CREATE ORDER REQUEST ============
app.post('/api/create-order', (req, res) => {
    const { customerName, email, phone, service, category, requirements, mockupImage } = req.body;
    
    const orders = getOrders();
    const newOrder = {
        id: 'REQ' + Date.now(),
        customerName,
        email,
        phone,
        service,
        category: category || 'General',
        requirements: requirements || 'No specific requirements provided',
        mockupImage: mockupImage || null,
        quotedPrice: null,
        status: 'pending_quote',
        paymentStatus: 'unpaid',
        type: 'request',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    orders.push(newOrder);
    saveOrders(orders);
    
    console.log(`\n📋 NEW REQUEST: ${newOrder.id}`);
    console.log(`   Customer: ${customerName} (${phone})`);
    console.log(`   Email: ${email}`);
    console.log(`   Service: ${service}`);
    
    if (mockupImage) {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        const mockupPath = path.join(uploadDir, `${newOrder.id}.png`);
        fs.writeFileSync(mockupPath, mockupImage, 'base64');
        console.log(`   📸 Mockup saved`);
    }
    
    sendSMS(phone, `TINEAL HUB: We received your request #${newOrder.id} (${service}). We will review and send you a quote within 24 hours. Track: ${BASE_URL}/track.html?id=${newOrder.id}`);
    
    res.json({ success: true, orderId: newOrder.id });
});

// ============ API: CREATE DATA ORDER ============
app.post('/api/create-data-order', (req, res) => {
    const { customerName, email, phone, network, dataSize, amount } = req.body;
    
    const orders = getOrders();
    const newOrder = {
        id: 'DATA' + Date.now(),
        customerName,
        email,
        phone,
        service: `${network} ${dataSize} Data Bundle`,
        requirements: `Auto-delivery to ${phone}`,
        amount: amount,
        network: network,
        dataSize: dataSize,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        type: 'data',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    orders.push(newOrder);
    saveOrders(orders);
    
    console.log(`\n📱 DATA ORDER: ${newOrder.id}`);
    console.log(`   Customer: ${customerName} (${phone})`);
    console.log(`   Bundle: ${network} ${dataSize} - GHS ${amount}`);
    
    res.json({ success: true, orderId: newOrder.id });
});

// ============ API: INITIALIZE PAYMENT FOR DATA ============
app.post('/api/initialize-data-payment', async (req, res) => {
    const { email, amount, orderId, customerName, phone, network, dataSize } = req.body;
    
    const paystackKey = process.env.PAYSTACK_SRC_KEY || process.env.PAYSTACK_SECRET_KEY;
    
    if (!paystackKey || paystackKey === 'your_paystack_secret_key_here') {
        return res.json({ success: false, error: 'Payment system not configured.' });
    }
    
    try {
        const response = await axios.post('https://api.paystack.co/transaction/initialize', {
            email: email,
            amount: amount * 100,
            callback_url: `${BASE_URL}/payment-callback.html`,
            metadata: {
                orderId: orderId,
                customerName: customerName,
                phone: phone,
                network: network,
                dataSize: dataSize,
                type: 'data'
            }
        }, {
            headers: {
                Authorization: `Bearer ${paystackKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        
        console.log(`💳 Data payment initialized for ${orderId}`);
        res.json({ success: true, authorization_url: response.data.data.authorization_url });
    } catch (error) {
        console.error('Data payment init error:', error.message);
        res.json({ success: false, error: 'Payment initialization failed.' });
    }
});

// ============ API: SEND QUOTE ============
app.post('/api/send-quote', requireAuth, async (req, res) => {
    const { orderId, quotedPrice, message } = req.body;
    
    const orders = getOrders();
    const orderIndex = orders.findIndex(o => o.id === orderId);
    
    if (orderIndex === -1) {
        return res.json({ success: false, error: 'Order not found' });
    }
    
    orders[orderIndex].quotedPrice = parseFloat(quotedPrice);
    orders[orderIndex].status = 'quoted';
    orders[orderIndex].updatedAt = new Date().toISOString();
    saveOrders(orders);
    
    const paymentLink = `${BASE_URL}/payment-page.html?id=${orderId}&amount=${quotedPrice}`;
    const fallbackLink = `${BASE_URL}/checkout.html?id=${orderId}`;
    const smsMessage = message || `TINEAL HUB: Quote for #${orderId} is GHS ${quotedPrice}. Pay here: ${paymentLink} | If link fails: ${fallbackLink}`;
    
    await sendSMS(orders[orderIndex].phone, smsMessage);
    
    console.log(`💰 Quote sent for ${orderId}: GHS ${quotedPrice}`);
    
    res.json({ success: true });
});

// ============ API: ACCEPT QUOTE ============
app.post('/api/accept-quote', async (req, res) => {
    const { orderId, email } = req.body;
    
    const orders = getOrders();
    const orderIndex = orders.findIndex(o => o.id === orderId);
    
    if (orderIndex === -1) {
        return res.json({ success: false, error: 'Order not found' });
    }
    
    if (orders[orderIndex].status !== 'quoted') {
        return res.json({ success: false, error: 'No active quote for this order' });
    }
    
    const customerEmail = email || orders[orderIndex].email;
    
    if (!customerEmail) {
        return res.json({ success: false, error: 'No email found for this order' });
    }
    
    const amount = orders[orderIndex].quotedPrice;
    const customerName = orders[orderIndex].customerName;
    const phone = orders[orderIndex].phone;
    
    const paystackKey = process.env.PAYSTACK_SRC_KEY || process.env.PAYSTACK_SECRET_KEY;
    
    if (!paystackKey || paystackKey === 'your_paystack_secret_key_here') {
        return res.json({ success: false, error: 'Payment system not configured.' });
    }
    
    try {
        const response = await axios.post('https://api.paystack.co/transaction/initialize', {
            email: customerEmail,
            amount: amount * 100,
            callback_url: `${BASE_URL}/payment-callback.html`,
            metadata: {
                orderId: orderId,
                customerName: customerName,
                phone: phone,
                type: 'service'
            }
        }, {
            headers: {
                Authorization: `Bearer ${paystackKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        
        orders[orderIndex].status = 'pending_payment';
        saveOrders(orders);
        
        res.json({ success: true, authorization_url: response.data.data.authorization_url });
    } catch (error) {
        console.error('Payment init error:', error.message);
        res.json({ success: false, error: 'Payment initialization failed.' });
    }
});

// ============ API: PAYSTACK WEBHOOK ============
app.post('/api/paystack-webhook', async (req, res) => {
    const event = req.body;
    
    if (event.event === 'charge.success') {
        const transaction = event.data;
        const metadata = transaction.metadata;
        const orderId = metadata.orderId;
        
        console.log(`💰 Payment received for order: ${orderId}`);
        
        const orders = getOrders();
        const orderIndex = orders.findIndex(o => o.id === orderId);
        
        if (orderIndex !== -1 && orders[orderIndex].paymentStatus !== 'paid') {
            orders[orderIndex].paymentStatus = 'paid';
            orders[orderIndex].status = 'paid';
            orders[orderIndex].updatedAt = new Date().toISOString();
            saveOrders(orders);
            
            if (metadata.type === 'data') {
                console.log(`📡 Processing data delivery for ${orderId} via DataMart...`);
                try {
                    const datamartResponse = await axios.post('https://api.datamart.com/purchase', {
                        network: metadata.network,
                        dataSize: metadata.dataSize,
                        phone: metadata.phone,
                        apiKey: process.env.DATAMART_API_KEY
                    }, { timeout: 30000 });
                    
                    console.log('DataMart Response:', datamartResponse.data);
                    await sendSMS(metadata.phone, `TINEAL HUB: Your ${metadata.network} ${metadata.dataSize} data bundle has been sent. Thank you!`);
                    orders[orderIndex].deliveryStatus = 'delivered';
                    saveOrders(orders);
                } catch (dmError) {
                    console.error('DataMart Error:', dmError.message);
                    await sendSMS(metadata.phone, `TINEAL HUB: Payment received. Data delivery will be resolved within 1 hour. Order #${orderId}`);
                    orders[orderIndex].deliveryStatus = 'failed';
                    saveOrders(orders);
                }
            } else {
                await sendSMS(metadata.phone, `TINEAL HUB: Payment received for #${orderId}. We will start working within 24 hours. Track: ${BASE_URL}/track.html?id=${orderId}`);
            }
        }
    }
    
    res.sendStatus(200);
});

// ============ API: VERIFY PAYMENT ============
app.get('/api/verify-payment/:reference', async (req, res) => {
    const { reference } = req.params;
    
    const paystackKey = process.env.PAYSTACK_SRC_KEY || process.env.PAYSTACK_SECRET_KEY;
    
    try {
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: {
                Authorization: `Bearer ${paystackKey}`
            },
            timeout: 15000
        });
        
        const transaction = response.data.data;
        
        if (transaction.status === 'success') {
            const metadata = transaction.metadata;
            const orderId = metadata.orderId;
            
            const orders = getOrders();
            const orderIndex = orders.findIndex(o => o.id === orderId);
            
            if (orderIndex !== -1 && orders[orderIndex].paymentStatus !== 'paid') {
                orders[orderIndex].paymentStatus = 'paid';
                orders[orderIndex].status = 'paid';
                orders[orderIndex].updatedAt = new Date().toISOString();
                saveOrders(orders);
                
                if (metadata.type === 'data') {
                    await sendSMS(metadata.phone, `TINEAL HUB: Payment confirmed for ${orderId}. Your data will be delivered shortly.`);
                } else {
                    await sendSMS(metadata.phone, `TINEAL HUB: Payment confirmed for ${orderId}. Work will begin soon.`);
                }
            }
            
            const order = orders.find(o => o.id === orderId);
            
            res.json({
                success: true,
                orderDetails: {
                    orderId: orderId,
                    service: order?.service || 'Your order',
                    amount: transaction.amount / 100
                }
            });
        } else {
            res.json({ success: false, error: 'Payment not successful' });
        }
    } catch (error) {
        console.error('Verification error:', error.message);
        res.json({ success: false, error: 'Verification failed' });
    }
});

// ============ API: GET ALL ORDERS ============
app.get('/api/orders', requireAuth, (req, res) => {
    const orders = getOrders();
    res.json(orders);
});

// ============ API: GET SINGLE ORDER ============
app.get('/api/order/:id', (req, res) => {
    const orders = getOrders();
    const order = orders.find(o => o.id === req.params.id);
    
    if (order) {
        res.json({
            id: order.id,
            customerName: order.customerName,
            email: order.email,
            phone: order.phone,
            service: order.service,
            requirements: order.requirements,
            quotedPrice: order.quotedPrice,
            amount: order.amount,
            network: order.network,
            dataSize: order.dataSize,
            status: order.status,
            paymentStatus: order.paymentStatus,
            deliveryStatus: order.deliveryStatus,
            deliveryType: order.deliveryType,
            deliveryLink: order.deliveryLink,
            deliveryFile: order.deliveryFile,
            deliveryNotes: order.deliveryNotes,
            type: order.type,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt
        });
    } else {
        res.status(404).json({ error: 'Order not found' });
    }
});

// ============ API: SEARCH ORDERS BY PHONE ============
app.post('/api/search-orders-by-phone', (req, res) => {
    const { phone } = req.body;
    const cleanSearchPhone = phone.toString().replace(/\D/g, '');
    
    const orders = getOrders();
    const matchingOrders = orders.filter(order => {
        const orderPhone = order.phone.toString().replace(/\D/g, '');
        return orderPhone.includes(cleanSearchPhone) || cleanSearchPhone.includes(orderPhone);
    });
    
    const safeOrders = matchingOrders.map(order => ({
        id: order.id,
        service: order.service,
        quotedPrice: order.quotedPrice,
        amount: order.amount,
        status: order.status,
        paymentStatus: order.paymentStatus,
        type: order.type,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
    }));
    
    res.json({ orders: safeOrders });
});

// ============ API: UPDATE ORDER STATUS WITH DELIVERY ============
app.post('/api/update-order-status-with-delivery', requireAuth, async (req, res) => {
    const { orderId, status, deliveryType, deliveryLink, deliveryFile, deliveryFileName, reviewNotes } = req.body;
    
    const orders = getOrders();
    const orderIndex = orders.findIndex(o => o.id === orderId);
    
    if (orderIndex === -1) {
        return res.json({ success: false, error: 'Order not found' });
    }
    
    console.log(`\n🔄 Updating order ${orderId} to status: ${status}`);
    console.log(`   Customer email: ${orders[orderIndex].email}`);
    console.log(`   Delivery type: ${deliveryType}`);
    
    // Save delivery file if provided
    let savedFileName = null;
    if (deliveryType === 'file' && deliveryFile && deliveryFileName) {
        const uploadDir = path.join(__dirname, 'public', 'deliveries');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        savedFileName = deliveryFileName;
        const filePath = path.join(uploadDir, savedFileName);
        fs.writeFileSync(filePath, deliveryFile, 'base64');
        console.log(`📎 File saved: ${savedFileName}`);
    }
    
    // Update order
    orders[orderIndex].status = status;
    orders[orderIndex].updatedAt = new Date().toISOString();
    
    if (deliveryType) orders[orderIndex].deliveryType = deliveryType;
    if (deliveryLink) orders[orderIndex].deliveryLink = deliveryLink;
    if (savedFileName) orders[orderIndex].deliveryFile = savedFileName;
    if (reviewNotes) orders[orderIndex].deliveryNotes = reviewNotes;
    
    saveOrders(orders);
    
    // Prepare delivery info for email
    let deliveryHtml = '';
    if (deliveryType === 'link' && deliveryLink) {
        deliveryHtml = `<p><strong>Access your work here:</strong> <a href="${deliveryLink}" style="color: #1a1a2e;">${deliveryLink}</a></p>`;
    } else if (deliveryType === 'file' && savedFileName) {
        const fileUrl = `${BASE_URL}/deliveries/${savedFileName}`;
        deliveryHtml = `<p><strong>Download your work:</strong> <a href="${fileUrl}" style="color: #1a1a2e;">Click here to download</a></p>`;
    }
    
    let statusMessage = '';
    let emailSubject = '';
    let emailHtml = '';
    
    switch(status) {
        case 'review':
            statusMessage = `Your project is ready for review. Check your email for access.`;
            emailSubject = `TINEAL HUB - Your project is ready for review - Order #${orderId}`;
            emailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h1 style="color: #1a1a2e; margin: 0;">TINEAL HUB</h1>
                        <p style="color: #666; margin: 5px 0;">Creative Tech + Connectivity</p>
                    </div>
                    <h2 style="color: #1a1a2e;">Your Project is Ready for Review</h2>
                    <p>Hello ${orders[orderIndex].customerName},</p>
                    <p>Your project <strong>(${orders[orderIndex].service})</strong> is now ready for your review.</p>
                    ${reviewNotes ? `<div style="background: #f8fafc; padding: 15px; border-radius: 12px; margin: 15px 0;"><strong>Notes from the team:</strong><br>${reviewNotes}</div>` : ''}
                    ${deliveryHtml}
                    <div style="background: #f8fafc; padding: 15px; border-radius: 12px; margin: 15px 0;">
                        <p><strong>Order ID:</strong> ${orderId}</p>
                        <p><strong>Track your order:</strong> <a href="${BASE_URL}/track.html?id=${orderId}" style="color: #1a1a2e;">${BASE_URL}/track.html?id=${orderId}</a></p>
                    </div>
                    <p>Please review and let us know if you need any changes.</p>
                    <br>
                    <p>Thank you for choosing TINEAL HUB!</p>
                    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                    <p style="font-size: 0.8rem; color: #666; text-align: center;">TINEAL HUB - Creative Tech + Connectivity</p>
                </div>
            `;
            break;
        case 'completed':
            statusMessage = `Your project is complete! Check your email for the final files.`;
            emailSubject = `TINEAL HUB - Your project is complete - Order #${orderId}`;
            emailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h1 style="color: #1a1a2e; margin: 0;">TINEAL HUB</h1>
                        <p style="color: #666; margin: 5px 0;">Creative Tech + Connectivity</p>
                    </div>
                    <h2 style="color: #1a1a2e;">Your Project is Complete!</h2>
                    <p>Hello ${orders[orderIndex].customerName},</p>
                    <p>Your project <strong>(${orders[orderIndex].service})</strong> is now complete.</p>
                    ${reviewNotes ? `<div style="background: #f8fafc; padding: 15px; border-radius: 12px; margin: 15px 0;"><strong>Notes from the team:</strong><br>${reviewNotes}</div>` : ''}
                    ${deliveryHtml}
                    <div style="background: #f8fafc; padding: 15px; border-radius: 12px; margin: 15px 0;">
                        <p><strong>Order ID:</strong> ${orderId}</p>
                    </div>
                    <p>Thank you for choosing TINEAL HUB. We hope you love the work!</p>
                    <br>
                    <p>Best regards,<br>TINEAL HUB Team</p>
                    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                    <p style="font-size: 0.8rem; color: #666; text-align: center;">TINEAL HUB - Creative Tech + Connectivity</p>
                </div>
            `;
            break;
        case 'in_progress':
            statusMessage = `Work has started on your project. You will receive updates as we progress.`;
            emailSubject = `TINEAL HUB - Work started on your order #${orderId}`;
            emailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h1 style="color: #1a1a2e; margin: 0;">TINEAL HUB</h1>
                        <p style="color: #666; margin: 5px 0;">Creative Tech + Connectivity</p>
                    </div>
                    <h2 style="color: #1a1a2e;">Work Started on Your Project</h2>
                    <p>Hello ${orders[orderIndex].customerName},</p>
                    <p>We have started working on your project <strong>(${orders[orderIndex].service})</strong>.</p>
                    ${reviewNotes ? `<div style="background: #f8fafc; padding: 15px; border-radius: 12px; margin: 15px 0;"><strong>Notes from the team:</strong><br>${reviewNotes}</div>` : ''}
                    <p>You will receive updates as we progress.</p>
                    <div style="background: #f8fafc; padding: 15px; border-radius: 12px; margin: 15px 0;">
                        <p><strong>Track your order:</strong> <a href="${BASE_URL}/track.html?id=${orderId}" style="color: #1a1a2e;">${BASE_URL}/track.html?id=${orderId}</a></p>
                    </div>
                    <br>
                    <p>Thank you for choosing TINEAL HUB!</p>
                    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                    <p style="font-size: 0.8rem; color: #666; text-align: center;">TINEAL HUB - Creative Tech + Connectivity</p>
                </div>
            `;
            break;
        default:
            statusMessage = `Order #${orderId} status: ${status.replace('_', ' ')}`;
    }
    
    // Send SMS
    await sendSMS(orders[orderIndex].phone, `TINEAL HUB: ${statusMessage}`);
    
    // Send Email for important updates
    if (status === 'review' || status === 'completed' || status === 'in_progress') {
        await sendEmail(orders[orderIndex].email, emailSubject, emailHtml);
    } else {
        console.log(`⚠️ No email sent for status: ${status}`);
    }
    
    console.log(`✅ Order ${orderId} updated to ${status}\n`);
    res.json({ success: true });
});

// ============ API: SIMPLE STATUS UPDATE ============
app.post('/api/update-order-status', requireAuth, async (req, res) => {
    const { orderId, status } = req.body;
    
    const orders = getOrders();
    const orderIndex = orders.findIndex(o => o.id === orderId);
    
    if (orderIndex === -1) {
        return res.json({ success: false, error: 'Order not found' });
    }
    
    orders[orderIndex].status = status;
    orders[orderIndex].updatedAt = new Date().toISOString();
    saveOrders(orders);
    
    let statusMessage = '';
    switch(status) {
        case 'in_progress':
            statusMessage = `Work has started on your project. You will receive updates as we progress.`;
            break;
        case 'completed':
            statusMessage = `Your project is complete! Check your email for the final files. Thank you!`;
            break;
        default:
            statusMessage = `Order #${orderId} status: ${status.replace('_', ' ')}`;
    }
    
    await sendSMS(orders[orderIndex].phone, `TINEAL HUB: ${statusMessage}`);
    res.json({ success: true });
});

// ============ SERVE HTML PAGES ============
app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/admin-login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.get('/payment-callback.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment-callback.html'));
});

app.get('/payment-page.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment-page.html'));
});

app.get('/checkout.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});

app.get('/track.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'track.html'));
});

app.get('/about.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

app.get('/shop.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'shop.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ START SERVER ============
app.listen(PORT, () => {
    console.log('\n=================================');
    console.log('🚀 TINEAL HUB is running');
    console.log('=================================');
    console.log(`📍 BASE_URL: ${BASE_URL}`);
    console.log(`📱 Store: ${BASE_URL}`);
    console.log(`🔒 Admin: ${BASE_URL}/admin-login.html`);
    console.log(`💳 Checkout: ${BASE_URL}/checkout.html`);
    console.log(`🔍 Track: ${BASE_URL}/track.html`);
    console.log(`📧 Test Email: POST ${BASE_URL}/api/test-email`);
    console.log(`🐛 Debug Order: GET ${BASE_URL}/api/debug-order/:id`);
    console.log('=================================\n');
    
    if (transporter) {
        console.log('✅ Email: Configured and ready');
        console.log(`   From: ${process.env.EMAIL_FROM || process.env.EMAIL_USER}`);
    } else {
        console.log('⚠️ Email: NOT CONFIGURED (will log to console)');
        console.log('   Add to .env: EMAIL_USER and EMAIL_PASS');
    }
    
    if (process.env.PAYSTACK_SRC_KEY || process.env.PAYSTACK_SECRET_KEY) {
        console.log('✅ Paystack: Configured');
    } else {
        console.log('⚠️ Paystack: NOT CONFIGURED');
    }
    
    if (process.env.ARKESEL_API_KEY && process.env.ARKESEL_API_KEY !== 'your_arkesel_api_key_here') {
        console.log('✅ Arkesel: Configured');
    } else {
        console.log('⚠️ Arkesel: NOT CONFIGURED (SMS logged to console)');
    }
    console.log('=================================\n');
});