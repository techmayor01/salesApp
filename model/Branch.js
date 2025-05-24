const mongoose = require('mongoose');

const branchSchema = new mongoose.Schema({
  branch_name: { type: String, required: true },
  branch_address: { type: String, required: true },
  branch_phone: { type: String, required: true },
  isHeadOffice: {
    type: Boolean,
    default: false
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false
  },

  // One or more users assigned to this branch
  assignedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],

  // Stock references
  stock: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product"
  }],

  supplier_invoice: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "SupplierInvoice"
  }],

  received_stock: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "ReceivedStock"
  }],

  customers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Customer"
  }],

  // Sales-related fields
  totalSales: {
    type: Number,
    default: 0
  },
  totalCashSalesAmount: {
    type: Number,
    default: 0
  },
  totalCreditSales: {
    type: Number,
    default: 0
  },
  totalDebtorsPayment: {
    type: Number,
    default: 0
  },

  createdAt: { type: Date, default: Date.now }
});

const Branch = mongoose.model('Branch', branchSchema);
module.exports = Branch;
