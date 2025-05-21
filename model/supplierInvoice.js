const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const supplierInvoiceSchema = new Schema({
  supplier: {
    type: Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true,
  },
  branch: {
    type: Schema.Types.ObjectId,
    ref: 'Branch',
    required: true,
    index: true
  },
  invoice_type: {
    type: String,
    enum: ['credit', 'debit'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  payment_date: {
    type: Date,
    required: true,
  },
  reason: {
    type: String,
    required: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  created_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
});

module.exports = mongoose.model('SupplierInvoice', supplierInvoiceSchema);
