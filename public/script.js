// Global variables
let currentOrderId = null;

// Global function for service selection (accessed from shop.html)
window.selectService = function(serviceName, price) {
    const modal = document.getElementById('orderModal');
    if (!modal) {
        console.error('Modal not found');
        return;
    }
    
    document.getElementById('serviceName').value = serviceName;
    document.getElementById('servicePrice').value = price;
    document.getElementById('amountDisplay').innerText = `GHS ${price}`;
    modal.style.display = 'block';
}

// Initialize page based on which page is loaded
document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    
    // Setup order form if it exists
    const orderForm = document.getElementById('orderForm');
    if (orderForm) {
        orderForm.addEventListener('submit', handleOrderSubmit);
    }
    
    if (path.includes('dashboard.html')) {
        loadDashboard();
        setInterval(loadDashboard, 30000); // Refresh every 30 seconds
    }
    
    if (path.includes('checkout.html')) {
        loadOrderSummary();
    }
    
    if (path.includes('track.html')) {
        // Check if URL has order ID parameter
        const urlParams = new URLSearchParams(window.location.search);
        const orderId = urlParams.get('id');
        if (orderId) {
            const orderIdInput = document.getElementById('trackOrderId');
            if (orderIdInput) {
                orderIdInput.value = orderId;
                if (typeof trackOrder === 'function') {
                    trackOrder();
                }
            }
        }
    }
});

// Handle order form submission
async function handleOrderSubmit(e) {
    e.preventDefault();
    
    const serviceName = document.getElementById('serviceName').value;
    const price = parseInt(document.getElementById('servicePrice').value);
    const customerName = document.getElementById('customerName').value;
    const email = document.getElementById('email').value;
    const phone = document.getElementById('phone').value;
    const requirements = document.getElementById('requirements').value;
    
    // Validate form
    if (!customerName || !email || !phone) {
        alert('Please fill in all required fields');
        return;
    }
    
    // Show loading state
    const submitBtn = e.target.querySelector('.pay-btn');
    const originalText = submitBtn.innerText;
    submitBtn.innerText = 'Processing...';
    submitBtn.disabled = true;
    
    try {
        // Create order
        const orderResponse = await fetch('/api/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customerName,
                email,
                phone,
                service: serviceName,
                requirements,
                amount: price
            })
        });
        
        const orderData = await orderResponse.json();
        
        if (orderData.success) {
            currentOrderId = orderData.orderId;
            
            // Initialize Paystack payment
            const paymentResponse = await fetch('/api/initialize-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email,
                    amount: price,
                    orderId: currentOrderId,
                    customerName: customerName,
                    phone: phone
                })
            });
            
            const paymentData = await paymentResponse.json();
            
            if (paymentData.success) {
                // Redirect to Paystack checkout
                window.location.href = paymentData.authorization_url;
            } else {
                alert('Payment initialization failed: ' + (paymentData.error || 'Please try again'));
                submitBtn.innerText = originalText;
                submitBtn.disabled = false;
            }
        } else {
            alert('Failed to create order. Please try again.');
            submitBtn.innerText = originalText;
            submitBtn.disabled = false;
        }
    } catch (error) {
        console.error('Order submission error:', error);
        alert('An error occurred. Please try again.');
        submitBtn.innerText = originalText;
        submitBtn.disabled = false;
    }
}

// Checkout page: Load order summary
function loadOrderSummary() {
    const summaryDiv = document.getElementById('orderSummary');
    if (summaryDiv) {
        // Get order details from localStorage or URL params
        const orderId = localStorage.getItem('lastOrderId') || currentOrderId;
        summaryDiv.innerHTML = `
            <h3>Order Details</h3>
            <p>Your order has been created. Click "Pay Now" to complete payment.</p>
            <p><strong>Order ID:</strong> ${orderId || 'Loading...'}</p>
        `;
    }
    
    const payNowBtn = document.getElementById('payNowBtn');
    if (payNowBtn) {
        payNowBtn.onclick = () => {
            alert('Redirecting to payment...');
        };
    }
}

// Dashboard: Load orders
async function loadDashboard() {
    const loadingSpinner = document.getElementById('loadingSpinner');
    const ordersContent = document.getElementById('ordersContent');
    
    if (loadingSpinner) loadingSpinner.style.display = 'block';
    if (ordersContent) ordersContent.style.display = 'none';
    
    try {
        const response = await fetchWithAuth('/api/orders');
        const orders = await response.json();
        
        // Update stats
        const totalOrders = orders.length;
        const pendingPayment = orders.filter(o => o.paymentStatus === 'unpaid').length;
        const inProgress = orders.filter(o => o.status === 'in_progress').length;
        const completed = orders.filter(o => o.status === 'completed').length;
        
        const totalOrdersEl = document.getElementById('totalOrders');
        const pendingOrdersEl = document.getElementById('pendingOrders');
        const inProgressOrdersEl = document.getElementById('inProgressOrders');
        const completedOrdersEl = document.getElementById('completedOrders');
        const lastUpdatedEl = document.getElementById('lastUpdated');
        
        if (totalOrdersEl) totalOrdersEl.innerText = totalOrders;
        if (pendingOrdersEl) pendingOrdersEl.innerText = pendingPayment;
        if (inProgressOrdersEl) inProgressOrdersEl.innerText = inProgress;
        if (completedOrdersEl) completedOrdersEl.innerText = completed;
        if (lastUpdatedEl) lastUpdatedEl.innerHTML = `Last updated: ${new Date().toLocaleTimeString()} | ${totalOrders} total orders`;
        
        // Render orders table
        const tbody = document.getElementById('ordersList');
        if (tbody) {
            tbody.innerHTML = '';
            
            if (orders.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">No orders yet</td></tr>';
            } else {
                orders.forEach(order => {
                    const row = tbody.insertRow();
                    row.innerHTML = `
                        <td><strong>${order.id}</strong><br><span style="font-size: 0.7rem; color: #999;">${new Date(order.createdAt).toLocaleDateString()}</span></td>
                        <td>${escapeHtml(order.customerName)}</td>
                        <td>${order.phone}</td>
                        <td>${escapeHtml(order.service)}</td>
                        <td>GHS ${order.amount}</td>
                        <td><span class="status-badge status-${getStatusClass(order.status)}">${formatStatus(order.status)}</span></td>
                        <td><span class="status-badge status-${order.paymentStatus === 'paid' ? 'completed' : 'pending'}">${order.paymentStatus === 'paid' ? '✅ Paid' : '⏳ Unpaid'}</span></td>
                        <td>
                            <select id="status-${order.id}" class="status-select" style="width: 130px;">
                                <option value="pending_payment" ${order.status === 'pending_payment' ? 'selected' : ''}>Pending Payment</option>
                                <option value="payment_received" ${order.status === 'payment_received' ? 'selected' : ''}>Payment Received</option>
                                <option value="in_progress" ${order.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                                <option value="review" ${order.status === 'review' ? 'selected' : ''}>Ready for Review</option>
                                <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>Completed</option>
                            </select>
                            <button onclick="updateOrderStatus('${order.id}')" class="update-btn" style="margin-top: 5px;">Update</button>
                        </td>
                    `;
                });
            }
        }
        
        if (loadingSpinner) loadingSpinner.style.display = 'none';
        if (ordersContent) ordersContent.style.display = 'block';
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
        if (loadingSpinner) {
            loadingSpinner.innerHTML = '<p style="color: red;">Error loading orders. <button onclick="loadDashboard()">Retry</button></p>';
        }
    }
}

// Update order status
async function updateOrderStatus(orderId) {
    const select = document.getElementById(`status-${orderId}`);
    if (!select) return;
    
    const newStatus = select.value;
    
    // Show loading on button
    const btn = event.target;
    const originalText = btn.innerText;
    btn.innerText = 'Updating...';
    btn.disabled = true;
    
    try {
        const response = await fetchWithAuth('/api/update-order-status', {
            method: 'POST',
            body: JSON.stringify({ orderId, status: newStatus })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('✅ Status updated! SMS sent to customer.');
            loadDashboard(); // Refresh
        } else {
            alert('❌ Failed to update status');
            btn.innerText = originalText;
            btn.disabled = false;
        }
    } catch (error) {
        console.error('Error updating status:', error);
        alert('Error updating status');
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// Helper function for authenticated API calls
async function fetchWithAuth(url, options = {}) {
    const auth = localStorage.getItem('adminAuth');
    
    if (!auth) {
        window.location.href = '/admin-login.html';
        throw new Error('No auth found');
    }
    
    const headers = {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
    };
    
    const response = await fetch(url, {
        ...options,
        headers: { ...headers, ...options.headers }
    });
    
    if (response.status === 401) {
        localStorage.removeItem('adminAuth');
        window.location.href = '/admin-login.html';
        throw new Error('Authentication failed');
    }
    
    return response;
}

// Helper functions for status display
function getStatusClass(status) {
    const classes = {
        'pending_payment': 'pending',
        'payment_received': 'paid',
        'in_progress': 'progress',
        'review': 'review',
        'completed': 'completed'
    };
    return classes[status] || 'pending';
}

function formatStatus(status) {
    const formats = {
        'pending_payment': '⏳ Pending Payment',
        'payment_received': '✅ Payment Received',
        'in_progress': '🔄 In Progress',
        'review': '👀 Ready for Review',
        'completed': '🎉 Completed'
    };
    return formats[status] || status;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('orderModal');
    if (event.target == modal) {
        modal.style.display = 'none';
    }
}

// Make functions globally available
window.updateOrderStatus = updateOrderStatus;
window.loadDashboard = loadDashboard;
window.closeModal = function() {
    const modal = document.getElementById('orderModal');
    if (modal) modal.style.display = 'none';
}