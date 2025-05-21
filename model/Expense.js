const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  title: {
    type: String,
    trim: true
  },
  amount: {
    type: Number,
    min: 0
  },
  category: {
    type: String,
    enum: ['rent', 'utilities', 'transport', 'maintenance', 'salary', 'misc'],
    default: 'misc'
  },
  date: {
    type: Date,
    default: Date.now
  },
  note: {
    type: String,
    trim: true
  },
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch'
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

module.exports = mongoose.model('Expense', expenseSchema);
