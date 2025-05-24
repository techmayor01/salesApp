const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  fullname: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },

  role: {
    type: String,
    enum: ['owner', 'admin', 'staff'],
    default: 'staff',
    required: true
  },

  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch'
  },

  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
module.exports = User;
