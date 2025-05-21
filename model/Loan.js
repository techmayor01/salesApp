const mongoose = require('mongoose');

const loanDetailSchema = new mongoose.Schema({
  loanAmount: {
    type: Number,
    required: true,
  },
  amount_to_repay: {
    type: Number,
    required: true,
  },
  loanContractDate: {
    type: Date,
    required: true,
  },
  loanContractEndDate: {
    type: Date,
    required: true,
  },
  details: {
    type: String,
  }
});

const loanSchema = new mongoose.Schema({
  loaner: {
    type: String,
    required: true,
  },
  mobile: {
    type: String,
    required: true,
  },
  address: {
    type: String,
  },
  loans: [loanDetailSchema],
}, {
  timestamps: true
});

module.exports = mongoose.model('Loan', loanSchema);
