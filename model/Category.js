const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  category_name: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;
