const mongoose = require('mongoose');

const customerLedgerSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: true
  },
  type: {
    type: String,
    enum: ['debit', 'payment'],
    required: true
  },
  refNo: {
    type: String,
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
  paid: {
    type: Number,
    default: 0
  },
  balance: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

module.exports = mongoose.model('CustomerLedger', customerLedgerSchema);
