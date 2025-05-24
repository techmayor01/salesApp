const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const staffLogSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['admin', 'staff'], required: true },
  signInTime: { type: Date, required: true, default: Date.now },
  signOutTime: { type: Date } // null until logged out
});

module.exports = mongoose.model('StaffLog', staffLogSchema);
