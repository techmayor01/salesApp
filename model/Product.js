const mongoose = require("mongoose");

const variantSchema = new mongoose.Schema({
  quantity: {
    type: Number
  },
  unitCode: {
    type: String
  },
  lowStockAlert: {
    type: Number,
    default: 0
  },
  sellPrice: {
    type: Number
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Supplier"
  },

  // Total quantity in base unit (computed)
  totalInBaseUnit: {
    type: Number,
    default: 0
  },

  // Total worth = quantity × supplierPrice
  totalWorth: {
    type: Number,
    default: 0
  },

  // Expected revenue based on sellPrice and quantity
  totalPotentialRevenue: {
    type: Number,
    default: 0
  },

  // Actual revenue based on sellPrice and sold quantity
  actualRevenue: {
    type: Number,
    default: 0
  },
  baseUnitQtyRef: Number,
  perBaseUnitCount: Number
}, { _id: false });

const productSchema = new mongoose.Schema({
  product: {
    type: String,
    required: true
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Category",
    required: true
  },
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Branch",
    required: true
  },
  product_detail: String,
  mfgDate: Date,
  expDate: Date,
  product_image: String,
  supplierPrice: {
    type: Number
  },

  // Variants now contain computed totalInBaseUnit and totalWorth
  variants: [variantSchema],

  transferredStock: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "TransferStock"
  }],
  created_at: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Product", productSchema);
