const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const supplierSchema = new mongoose.Schema({
  supplier: { type: String },
  contact_person: { type: String },
  email: { type: String },
  phone: { type: String },
  address: { type: String },
  supplierInvoice: {
    type: Schema.Types.ObjectId,
    ref: 'SupplierInvoice'
  },
  createdAt: { type: Date, default: Date.now }
});

const Supplier = mongoose.model('Supplier', supplierSchema);

module.exports = Supplier;
