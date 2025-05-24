const mongoose = require('mongoose');

const cashReceivableSchema = new mongoose.Schema({
  transactionType: {
    type: String,
    enum: ['Customer', 'Loan'],
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'transactionType'
  },
  expectedAmount: {
    type: Number,
    required: true
  },
  amountReceived: {
    type: Number,
    required: true
  },
  balanceRemaining: {
    type: Number,
    required: true
  },
  paymentDate: {
    type: Date,
    required: true
  },
  paymentType: {
    type: String,
    enum: ['Cash', 'Credit Card', 'Bank Transfer'],
    required: true
  },
  reference: {
    type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('CashReceivable', cashReceivableSchema);
