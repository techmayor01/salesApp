const mongoose = require('mongoose');

const stockLogSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  field: { type: String, required: true },          // e.g. "productName", "variants[0].quantity"
  oldValue: { type: mongoose.Schema.Types.Mixed },  // old value can be any type
  newValue: { type: mongoose.Schema.Types.Mixed },  // new value can be any type
  changedAt: { type: Date, default: Date.now },
  reason: { type: String },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});

module.exports = mongoose.model('StockLog', stockLogSchema);
