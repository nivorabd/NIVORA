```javascript
'use strict';

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));

app.use(express.urlencoded({
  extended: false,
  limit: '1mb'
}));

// Basic health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'NIVORA ONE',
    paymentApi: 'available-but-not-configured',
    time: new Date().toISOString()
  });
});

// Payment summary
app.get('/api/payments/summary', (req, res) => {
  res.set('Cache-Control', 'no-store');

  res.json({
    todayCollection: 0,
    successful: 0,
    pending: 0,
    refundedAmount: 0,
    currency: 'BDT',
    configured: false,
    message: 'Payment gateway is not configured.'
  });
});

// Transaction list
app.get('/api/payments/transactions', (req, res) => {
  res.set('Cache-Control', 'no-store');

  res.json({
    transactions: [],
    configured: false,
    message: 'No transaction database is connected yet.'
  });
});

// Create payment session.
// Real payment creation must be connected to an approved gateway.
app.post('/api/payments/create', (req, res) => {
  const { amount, currency, orderId, method } = req.body || {};

  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 10000000
  ) {
    return res.status(400).json({
      ok: false,
      error: 'INVALID_AMOUNT',
      message: 'Enter a valid payment amount.'
    });
  }

  if (
    typeof orderId !== 'string' ||
    !orderId.trim() ||
    orderId.length > 120
  ) {
    return res.status(400).json({
      ok: false,
      error: 'INVALID_ORDER_ID',
      message: 'A valid order ID is required.'
    });
  }

  const allowedMethods = [
    'bkash',
    'nagad',
    'rocket',
    'card',
    'bank',
    'qr',
    'international',
    'cod'
  ];

  if (
    typeof method !== 'string' ||
    !allowedMethods.includes(method.toLowerCase())
  ) {
    return res.status(400).json({
      ok: false,
      error: 'INVALID_PAYMENT_METHOD',
      message: 'Unsupported payment method.'
    });
  }

  if (currency && !['BDT', 'USD', 'EUR'].includes(currency)) {
    return res.status(400).json({
      ok: false,
      error: 'INVALID_CURRENCY',
      message: 'Unsupported currency.'
    });
  }

  // Do not pretend a payment has been created or completed.
  return res.status(503).json({
    ok: false,
    error: 'PAYMENT_GATEWAY_NOT_CONFIGURED',
    message:
      'Real payments are unavailable until an approved payment gateway is connected.'
  });
});

// Refund endpoint.
// Must be implemented with gateway verification, authorization,
// database checks and duplicate-refund protection before use.
app.post('/api/payments/refund', (req, res) => {
  return res.status(503).json({
    ok: false,
    error: 'REFUND_SERVICE_NOT_CONFIGURED',
    message:
      'Refunds are disabled until secure gateway integration and admin authorization are configured.'
  });
});

// Serve the frontend when it is deployed alongside this server.
app.use(express.static(path.join(__dirname)));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      ok: false,
      error: 'API_ROUTE_NOT_FOUND'
    });
  }

  res.status(404).send('Page not found');
});

// Do not start a listener when imported as a serverless function.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`NIVORA ONE server running on port ${PORT}`);
  });
}

module.exports = app;
```
