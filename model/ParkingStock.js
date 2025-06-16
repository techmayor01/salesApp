// models/ParkingStock.js
const mongoose = require("mongoose");
const { Schema, Types } = mongoose;

const parkingStockSchema = new Schema({
  parkingStore: {
    type: Types.ObjectId,
    ref: "ParkingStore",
    required: true
  },
  branch: {
    type: Types.ObjectId,
    ref: "Branch",
    required: true
  },
  product: {
    type: Types.ObjectId,
    ref: "Product",
    required: true
  },
  unitCode: { type: String, required: true },
  quantity: { type: Number, required: true },

  // Core for conversions
  totalInBaseUnit: { type: Number, default: 0 },

  // Optional snapshot for variant details
  variantSnapshot: {
    unitCode: String,
    sellPrice: Number,
    totalInBaseUnit: Number,
    lowStockAlert: Number,
  },

  parkedBy: { type: Types.ObjectId, ref: "User" },
  parkedAt: { type: Date, default: Date.now }
});

// Index adjusted to allow multiple variants per product
parkingStockSchema.index(
  { parkingStore: 1, product: 1, unitCode: 1 },
  { unique: true }
);

module.exports = mongoose.model("ParkingStock", parkingStockSchema);
