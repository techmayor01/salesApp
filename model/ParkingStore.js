const mongoose = require("mongoose");
const { Schema, Types } = mongoose;

const parkingStoreSchema = new Schema({
  branch: {
    type: Types.ObjectId,
    ref: "Branch",
    required: true
  },
  storeName: {
    type: String,
    required: true
  },
  createdBy: { type: Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now }
});
parkingStoreSchema.index({ branch: 1, storeName: 1 }, { unique: true });

module.exports = mongoose.model("ParkingStore", parkingStoreSchema);
