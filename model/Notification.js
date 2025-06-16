const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },

  description: {
    type: String,
    required: true,
  },

  type: {
    type: String,
    enum: ['transferStock', 'expiredStock', 'debtorsPayment', 'loan', 'lowStock'],
    required: true,
  },

  pageLink: {
    type: String,
    default: null,
  },

  requiresApproval: {
    type: Boolean,
    default: false,
  },

  isDismissed: {
    type: Boolean,
    default: false,
  },

  isApproved: {
    type: Boolean,
    default: false,
  },

  isIgnored: {
    type: Boolean,
    default: false,
  },

  ignoreUntil: {
    type: Date,
    default: null,
  },

  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: true // <== This is important for filtering
 },
  createdAt: {
    type: Date,
    default: Date.now,
  }
});

module.exports = mongoose.model("Notification", notificationSchema);
