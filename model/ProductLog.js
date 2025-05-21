const mongoose = require('mongoose');

const productChangeLogSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // who made the change
  changeDate: { type: Date, default: Date.now },
  changeType: { type: String, enum: ['delete', 'update', 'refund'], required: true },
  oldVariantData: {
    quantity: Number,
    supplierPrice: Number
  },
  newVariantData: {
    quantity: Number,
    supplierPrice: Number
  },
  variantUnitCode: String,
  remarks: String,
  balance: { type: Number, default: 0 }, 
  refund: { type: Number, default: 0 }
});

const ProductChangeLog = mongoose.model('ProductChangeLog', productChangeLogSchema);

module.exports = ProductChangeLog;
