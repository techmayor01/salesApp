const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const variantLedgerSchema = new Schema({
  unitCode: {
    type: String,
    required: true
  },
  stock_in: {
    type: Number,
    default: 0
  },
  stock_out: {
    type: Number,
    default: 0
  },
  balance: {
    type: Number,
    required: true
  }
}, { _id: false });

const stockLedgerSchema = new Schema({
  date: {
    type: Date,
    required: true
  },
  product: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  variants: [variantLedgerSchema],
  operator: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  branch: {
    type: Schema.Types.ObjectId,
    ref: 'Branch',
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('StockLedger', stockLedgerSchema);
