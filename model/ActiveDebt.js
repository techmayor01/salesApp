const mongoose = require('mongoose');

const activeDebtSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    unique: true
  },
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: true
  },
  total_balance: {
    type: Number,
    required: true
  },
  invoices: [
    {
      refNo: { type: String, required: true },
      balance: { type: Number, required: true }
    }
  ],
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.model('ActiveDebt', activeDebtSchema);
