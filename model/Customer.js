const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  customer_name: { type: String },
  mobile: { type: String },
  email: { type: String },
  address: { type: String },

  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Branch",
    required: true
  },

  transactions: [
    {
      product: { type: String, required: true },
      qty: { type: Number, required: true }, 
      unit_code: { type: String }, 
      rate: { type: Number, required: true },
      total: { type: Number, required: true },        
      paid_amount: { type: Number },
      remaining_amount: { type: Number },
    }
  ],
  credit_limit: { type: Number },
  total_debt: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now }
});

const Customer = mongoose.model('Customer', customerSchema);

module.exports = Customer;
