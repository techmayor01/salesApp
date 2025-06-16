const mongoose = require('mongoose');

const supplierLedgerSchema = new mongoose.Schema({
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: true
  },
  type: {
    type: String,
    enum: ['debit', 'credit'],
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  amount: {
    type: Number,
    default: 0
  },
  balance: {
    type: Number,
    default: 0
  },
  reason: {
    type: String,
    required: true
  },
}, { timestamps: true });

module.exports = mongoose.model('SupplierLedger', supplierLedgerSchema);
