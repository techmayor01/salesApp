const mongoose = require('mongoose');

const invoiceItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  product_name: String, // Optional if you want to store name directly
  qty: {
    type: Number,
    required: true
  },
  unitcode: {
    type: String,
    required: true
  },
  rate: {
    type: Number,
    required: true
  },
  total: {
    type: Number,
    required: true
  }
});

const invoiceSchema = new mongoose.Schema({
  customer_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  customer_name: {
    type: String,
    required: true
  },
  payment_date: {
    type: Date,
    required: true
  },
  sales_type: {
    type: String,
    enum: ['cash', 'credit'],
    required: true
  },
  items: [invoiceItemSchema], // <-- this stores the multiple product lines
  paid_amount: {
    type: Number,
    required: true
  },
  remaining_amount: {
    type: Number,
    default: 0
  },
  payment_type: {
    type: String,
    enum: ['cash', 'transfer', 'pos', 'credit', 'other'],
    required: true
  },
  grand_total: {
    type: Number,
    required: true
  },
  invoice_no: {
    type: String,
    required: true
  },
  receipt_no: {
    type: String,
    required: true
  },
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
});

module.exports = mongoose.model('Invoice', invoiceSchema);
