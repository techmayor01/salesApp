const mongoose = require('mongoose');

const ConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  value: {
    type: mongoose.Schema.Types.Mixed, // can be boolean, string, number, etc.
    required: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('Config', ConfigSchema);
