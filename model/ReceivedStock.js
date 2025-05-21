const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const receivedStockSchema = new Schema({
  invoice_number: {
    type: String,
    required: true
  },
  supplier: {
    type: Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true,
  },
  branch: {
    type: Schema.Types.ObjectId,
    ref: 'Branch',
    required: true,
  },
  payment_date: {
    type: Date,
    required: true,
  },
  items: [
    {
      product: {
        type: Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
      },
      item_name: {
        type: String,
        required: true,
      },
      unitCode: String,
      item_qty: {
        type: Number,
        required: true,
      },
      item_rate: {
        type: Number,
        required: true,
      },
      item_total: {
        type: Number,
        required: true,
      }
    }
  ],
  grand_total: {
    type: Number,
    required: true,
  },
  paid_amount: {
    type: Number,
    required: true,
  },
  due_amount: {
    type: Number,
    required: true,
  },
  payment_status: {
    type: String,
    enum: ['paid_half', 'paid_full'],
    default: 'paid_half',
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

receivedStockSchema.pre('save', function(next) {
  this.due_amount = this.grand_total - this.paid_amount;
  next();
});

module.exports = mongoose.model('ReceivedStock', receivedStockSchema);
