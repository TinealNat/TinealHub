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
const BASE_URL = process.env.BASE_URL || 'https://tinealhub.onrender.com';

// Admin credentials
const ADMIN_USERNAME = 'tinealadmin';
const ADMIN_PASSWORD = 'TinealHub2024!';

// Email transporter setup
let transporter = null;

console.log('🚀 TINEAL HUB Starting...');
console.log(`📍 Base URL: ${BASE_URL}`);

// Check if email should be configured
const isEmailConfigured = process.env.EMAIL_USER && 
                         process.env.EMAIL_USER !== 'your_email@gmail.com' && 
                         process.env.EMAIL_PASS && 
                         process.env.EMAIL_PASS !== 'your_password';

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
        console.log('✅ Email transporter initialized');
    } catch (error) {
        console.log('⚠️ Email error:', error.message);
        transporter = null;
    }
} else {
    console.log('⚠️ Email not configured - will log to console');
}

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Serve delivery files
app.use('/deliveries', express.static(path.join(__dirname, 'public', 'deliveries')));

// ============ URL REWRITING (Hide .html extensions) ============
app.use((req, res, next) => {
    // Skip API routes and static assets with extensions
    if (req.path.startsWith('/api/') || (req.path.includes('.') && !req.path.endsWith('.html'))) {
        return next();
    }
    
    // Remove trailing slash
    let cleanPath = req.path;
    if (cleanPath.endsWith('/') && cleanPath !== '/') {
        cleanPath = cleanPath.slice(0, -1);
    }
    
    // Try to find matching .html file (skip root)
    if (cleanPath !== '/') {
        const htmlPath = path.join(__dirname, 'public', cleanPath + '.html');
        if (fs.existsSync(htmlPath)) {
            req.url = cleanPath + '.html';
        }
    }
    next();
});

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
    
    if (!transporter) {
        console.log('⚠️ Email not configured. Would have sent:');
        console.log('----------------------------------------');
        console.log(htmlContent.substring(0, 500));
        console.log('----------------------------------------\n');
        return true;
    }
    
    if (!to || to === 'undefined' || to === 'null' || !to.includes('@')) {
        console.log('❌ Invalid email address:', to);
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
        console.log(`✅ Email sent! Message ID: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error('❌ Email failed:', error.message);
        return false;
    }
}

// ============ API ENDPOINTS ============

// Create order request
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
    
    sendSMS(phone, `TINEAL HUB: Request #${newOrder.id} received. Track: ${BASE_URL}/track?id=${newOrder.id}`);
    res.json({ success: true, orderId: newOrder.id });
});

// Create data order
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

// Initialize payment for data
app.post('/api/initialize-data-payment', async (req, res) => {
    const { email, amount, orderId, customerName, phone, network, dataSize } = req.body;
    
    const paystackKey = process.env.PAYSTACK_SRC_KEY || process.env.PAYSTACK_SECRET_KEY;
    
    if (!paystackKey || paystackKey === 'your_paystack_secret_key_here') {
        return res.json({ success: false, error: 'Payment not configured.' });
    }
    
    try {
        const response = await axios.post('https://api.paystack.co/transaction/initialize', {
            email: email,
            amount: amount * 100,
            callback_url: `${BASE_URL}/payment-callback`,
            metadata: {
                orderId: orderId,
                customerName: customerName,
                phone: phone,
                network: network,
                dataSize: dataSize,
                type: 'data'
            }
        }, {
            headers: { Authorization: `Bearer ${paystackKey}` },
            timeout: 15000
        });
        
        console.log(`💳 Data payment initialized for ${orderId}`);
        res.json({ success: true, authorization_url: response.data.data.authorization_url });
    } catch (error) {
        console.error('Payment error:', error.message);
        res.json({ success: false, error: 'Payment initialization failed.' });
    }
});

// Send quote to customer
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
    
    const paymentLink = `${BASE_URL}/payment-page?id=${orderId}&amount=${quotedPrice}`;
    const fallbackLink = `${BASE_URL}/checkout?id=${orderId}`;
    const smsMessage = message || `TINEAL HUB: Quote for #${orderId} is GHS ${quotedPrice}. Pay: ${paymentLink} | Fallback: ${fallbackLink}`;
    
    await sendSMS(orders[orderIndex].phone, smsMessage);
    console.log(`💰 Quote sent for ${orderId}: GHS ${quotedPrice}`);
    res.json({ success: true });
});

// Accept quote and initialize payment
app.post('/api/accept-quote', async (req, res) => {
    const { orderId, email } = req.body;
    
    const orders = getOrders();
    const orderIndex = orders.findIndex(o => o.id === orderId);
    
    if (orderIndex === -1) {
        return res.json({ success: false, error: 'Order not found' });
    }
    
    if (orders[orderIndex].status !== 'quoted') {
        return res.json({ success: false, error: 'No active quote' });
    }
    
    const customerEmail = email || orders[orderIndex].email;
    const amount = orders[orderIndex].quotedPrice;
    const customerName = orders[orderIndex].customerName;
    const phone = orders[orderIndex].phone;
    const paystackKey = process.env.PAYSTACK_SRC_KEY || process.env.PAYSTACK_SECRET_KEY;
    
    try {
        const response = await axios.post('https://api.paystack.co/transaction/initialize', {
            email: customerEmail,
            amount: amount * 100,
            callback_url: `${BASE_URL}/payment-callback`,
            metadata: { orderId, customerName, phone, type: 'service' }
        }, {
            headers: { Authorization: `Bearer ${paystackKey}` },
            timeout: 15000
        });
        
        orders[orderIndex].status = 'pending_payment';
        saveOrders(orders);
        res.json({ success: true, authorization_url: response.data.data.authorization_url });
    } catch (error) {
        res.json({ success: false, error: 'Payment init failed' });
    }
});

// Paystack webhook
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
                console.log(`📡 Data delivery for ${orderId}...`);
                try {
                    await sendSMS(metadata.phone, `TINEAL HUB: Your ${metadata.network} ${metadata.dataSize} data bundle has been sent. Thank you!`);
                    orders[orderIndex].deliveryStatus = 'delivered';
                    saveOrders(orders);
                } catch (dmError) {
                    console.error('Delivery Error:', dmError.message);
                    await sendSMS(metadata.phone, `TINEAL HUB: Payment received. Data delivery will be resolved within 1 hour. Order #${orderId}`);
                    orders[orderIndex].deliveryStatus = 'pending';
                    saveOrders(orders);
                }
            } else {
                await sendSMS(metadata.phone, `TINEAL HUB: Payment received for #${orderId}. Track: ${BASE_URL}/track?id=${orderId}`);
            }
        }
    }
    res.sendStatus(200);
});

// Verify payment
app.get('/api/verify-payment/:reference', async (req, res) => {
    const { reference } = req.params;
    const paystackKey = process.env.PAYSTACK_SRC_KEY || process.env.PAYSTACK_SECRET_KEY;
    
    try {
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${paystackKey}` },
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
                saveOrders(orders);
            }
            
            const order = orders.find(o => o.id === orderId);
            res.json({ success: true, orderDetails: { orderId, amount: transaction.amount / 100 } });
        } else {
            res.json({ success: false, error: 'Payment not successful' });
        }
    } catch (error) {
        res.json({ success: false, error: 'Verification failed' });
    }
});

// Get all orders (protected)
app.get('/api/orders', requireAuth, (req, res) => {
    res.json(getOrders());
});

// Get single order (public)
app.get('/api/order/:id', (req, res) => {
    const order = getOrders().find(o => o.id === req.params.id);
    if (order) res.json(order);
    else res.status(404).json({ error: 'Not found' });
});

// Search orders by phone
app.post('/api/search-orders-by-phone', (req, res) => {
    const { phone } = req.body;
    const cleanPhone = phone.toString().replace(/\D/g, '');
    const orders = getOrders().filter(o => o.phone.toString().replace(/\D/g, '').includes(cleanPhone));
    res.json({ orders: orders.map(o => ({ id: o.id, service: o.service, status: o.status, createdAt: o.createdAt })) });
});

// Update order status with delivery
app.post('/api/update-order-status-with-delivery', requireAuth, async (req, res) => {
    const { orderId, status, deliveryType, deliveryLink, deliveryFile, deliveryFileName, reviewNotes } = req.body;
    
    const orders = getOrders();
    const orderIndex = orders.findIndex(o => o.id === orderId);
    
    if (orderIndex === -1) {
        return res.json({ success: false, error: 'Order not found' });
    }
    
    let savedFileName = null;
    if (deliveryType === 'file' && deliveryFile && deliveryFileName) {
        const uploadDir = path.join(__dirname, 'public', 'deliveries');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        savedFileName = deliveryFileName;
        fs.writeFileSync(path.join(uploadDir, savedFileName), deliveryFile, 'base64');
        console.log(`📎 File saved: ${savedFileName}`);
    }
    
    orders[orderIndex].status = status;
    orders[orderIndex].updatedAt = new Date().toISOString();
    if (deliveryLink) orders[orderIndex].deliveryLink = deliveryLink;
    if (savedFileName) orders[orderIndex].deliveryFile = savedFileName;
    if (reviewNotes) orders[orderIndex].deliveryNotes = reviewNotes;
    saveOrders(orders);
    
    let deliveryHtml = '';
    if (deliveryType === 'link' && deliveryLink) {
        deliveryHtml = `<p><a href="${deliveryLink}">Access your work</a></p>`;
    } else if (deliveryType === 'file' && savedFileName) {
        deliveryHtml = `<p><a href="${BASE_URL}/deliveries/${savedFileName}">Download your work</a></p>`;
    }
    
    let emailSubject = '', emailHtml = '';
    let statusMessage = '';
    
    if (status === 'review') {
        statusMessage = `Your project is ready for review.`;
        emailSubject = `TINEAL HUB - Ready for Review - Order #${orderId}`;
        emailHtml = `<h2>Ready for Review</h2><p>Hello ${orders[orderIndex].customerName},</p><p>Your ${orders[orderIndex].service} is ready.</p>${deliveryHtml}<p><a href="${BASE_URL}/track?id=${orderId}">Track Order</a></p>`;
    } else if (status === 'completed') {
        statusMessage = `Your project is complete!`;
        emailSubject = `TINEAL HUB - Order Complete - #${orderId}`;
        emailHtml = `<h2>Order Complete</h2><p>Hello ${orders[orderIndex].customerName},</p><p>Your ${orders[orderIndex].service} is complete.</p>${deliveryHtml}<p>Thank you!</p>`;
    } else if (status === 'in_progress') {
        statusMessage = `Work has started on your project.`;
        emailSubject = `TINEAL HUB - Work Started - #${orderId}`;
        emailHtml = `<h2>Work Started</h2><p>Hello ${orders[orderIndex].customerName},</p><p>We have started working on your ${orders[orderIndex].service}.</p>`;
    }
    
    await sendSMS(orders[orderIndex].phone, `TINEAL HUB: ${statusMessage}`);
    if (status === 'review' || status === 'completed') {
        await sendEmail(orders[orderIndex].email, emailSubject, emailHtml);
    }
    
    res.json({ success: true });
});

// Test email endpoint
app.post('/api/test-email', requireAuth, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.json({ success: false, error: 'Email required' });
    const result = await sendEmail(email, 'TINEAL HUB - Test', '<h2>Test</h2><p>Email works!</p>');
    res.json({ success: result, message: result ? 'Email sent!' : 'Failed' });
});

// Debug order endpoint
app.get('/api/debug-order/:id', requireAuth, (req, res) => {
    const order = getOrders().find(o => o.id === req.params.id);
    if (order) res.json({ id: order.id, email: order.email, status: order.status });
    else res.json({ error: 'Not found' });
});

// ============ SERVE HTML PAGES (Clean URLs) ============
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/admin-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
app.get('/payment-callback', (req, res) => res.sendFile(path.join(__dirname, 'public', 'payment-callback.html')));
app.get('/payment-page', (req, res) => res.sendFile(path.join(__dirname, 'public', 'payment-page.html')));
app.get('/checkout', (req, res) => res.sendFile(path.join(__dirname, 'public', 'checkout.html')));
app.get('/track', (req, res) => res.sendFile(path.join(__dirname, 'public', 'track.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'public', 'about.html')));
app.get('/shop', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Start server
app.listen(PORT, () => {
    console.log('\n=================================');
    console.log('🚀 TINEAL HUB is running');
    console.log('=================================');
    console.log(`📍 Base URL: ${BASE_URL}`);
    console.log(`📱 Store: ${BASE_URL}`);
    console.log(`🔒 Admin: ${BASE_URL}/admin-login`);
    console.log(`💳 Checkout: ${BASE_URL}/checkout`);
    console.log(`🔍 Track: ${BASE_URL}/track`);
    console.log(`📧 Test Email: POST ${BASE_URL}/api/test-email`);
    console.log('=================================\n');
    
    if (transporter) {
        console.log('✅ Email: Configured');
    } else {
        console.log('⚠️ Email: NOT CONFIGURED');
    }
    
    if (process.env.PAYSTACK_SRC_KEY || process.env.PAYSTACK_SECRET_KEY) {
        console.log('✅ Paystack: Configured');
    } else {
        console.log('⚠️ Paystack: NOT CONFIGURED');
    }
    
    if (process.env.ARKESEL_API_KEY) {
        console.log('✅ Arkesel: Configured');
    } else {
        console.log('⚠️ Arkesel: NOT CONFIGURED');
    }
    console.log('=================================\n');
});