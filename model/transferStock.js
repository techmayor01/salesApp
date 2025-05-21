const mongoose = require('mongoose');


const transferStockSchema = new mongoose.Schema({
  transaction_number: { 
    type: String
  },

  from_branch: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Branch", 
    required: true 
  },

  to_branch: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Branch", 
    required: true 
  },

  transfer_date: { 
    type: Date, 
    required: true 
  },

  note: { 
    type: String, 
    default: '' 
  },

  // Array of stock transfers
  stock: [{
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product", // Reference to Product schema
      required: true
    },
    product: String,
    unitCode: String,
    quantity: Number,
    supplierPrice: Number,
    sellPrice: Number,
    worth: Number
  }],
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

module.exports = mongoose.model("TransferStock", transferStockSchema);