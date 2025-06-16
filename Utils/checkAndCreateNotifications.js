const Notification = require("../model/Notification");
const Product = require("../model/Product");
const Invoice = require("../model/Invoice");
const Loan = require("../model/Loan");
const TransferStock = require("../model/transferStock");

module.exports = async function checkAndCreateNotifications(user) {
  const isOwner = user.role === "owner";
  const branchId = user.branch._id;

  // Helper to avoid duplicates
  const createNotification = async (query) => {
    const exists = await Notification.findOne({
      title: query.title,
      type: query.type,
      pageLink: query.pageLink,
      isDismissed: false,
    });
    if (!exists) await Notification.create(query);
  };

  // 🔴 1. Expired Stock
  const expiredProducts = await Product.find({
    branch: isOwner ? { $exists: true } : branchId,
    expDate: { $lt: new Date() },
  }).populate("branch");

  if (expiredProducts.length) {
    const branches = [...new Set(expiredProducts.map(p => p.branch._id.toString()))];
    for (const bId of branches) {
      const count = expiredProducts.filter(p => p.branch._id.toString() === bId).length;
      const branchName = expiredProducts.find(p => p.branch._id.toString() === bId).branch.branch_name;
      await createNotification({
        title: "Expired Stock Alert",
        description: `There are ${count} expired product(s) at branch ${branchName}.`,
        type: "expiredStock",
        pageLink: `/expiredProducts?branchId=${bId}`,
        requiresApproval: false,
        isDismissed: false,
        isApproved: false,
        isIgnored: false,
        metadata: null,
        branch: bId
      });
    }
  }

  // 🟠 2. Low Stock (only first variant)
  const lowStockProducts = await Product.find({
    branch: isOwner ? { $exists: true } : branchId,
  }).populate("branch");

  for (const product of lowStockProducts) {
    const variant = product.variants?.[0];
    if (variant && variant.quantity < variant.lowStockAlert) {
      await createNotification({
        title: "Low Stock Alert",
        description: `${product.product} is low on stock at ${product.branch.branch_name}.`,
        type: "lowStock",
        pageLink: `/product/${product._id}`,
        requiresApproval: false,
        isDismissed: false,
        isApproved: false,
        isIgnored: false,
        metadata: null,
        branch: product.branch._id
      });
    }
  }

  // 🟡 3. Debtors
const debtors = await Invoice.find({
  ...(isOwner ? {} : { branch: branchId }),
  remaining_amount: { $gt: 0 }
}).populate("branch");

for (const debtor of debtors) {
  // Check if notification for this invoice already exists
  const exists = await Notification.findOne({
    type: "debtors",
    "metadata.invoiceId": debtor._id
  });

  if (!exists) {
    await createNotification({
      title: `Debtor Alert - ${debtor.customer_name} from ${debtor.branch.branch_name} Branch`,
      description: `${debtor.customer_name} has unpaid balance of ₦${debtor.remaining_amount.toLocaleString()}.`,
      type: "debtorsPayment",
      pageLink: `/customer/${debtor._id}`,
      requiresApproval: false,
      isDismissed: false,
      isApproved: false,
      isIgnored: false,
      metadata: {
        invoiceId: debtor._id,
        customerId: debtor.customer_id,
        invoiceNo: debtor.invoice_no,
        remaining: debtor.remaining_amount
      },
      branch: debtor.branch
    });
  }
}


  // 🔵 4. Loans
  const loans = await Loan.find({
    branch: isOwner ? { $exists: true } : branchId,
    balance: { $gt: 0 }
  }).populate("user branch");

  for (const loan of loans) {
    await createNotification({
      title: "Loan Alert",
      description: `${loan.user.name} has an outstanding loan balance of ₦${loan.balance.toLocaleString()}.`,
      type: "loan",
      pageLink: `/loans/${loan._id}`,
      requiresApproval: false,
      isDismissed: false,
      isApproved: false,
      isIgnored: false,
      metadata: null,
      branch: loan.branch
    });
  }

  // 🟣 5. TransferStock
  const transfers = await TransferStock.find({
    to_branch: isOwner ? { $exists: true } : branchId,
    approved: { $ne: true }
  }).populate("from_branch to_branch");

  for (const transfer of transfers) {
    await createNotification({
      title: "Pending Stock Transfer",
      description: `Stock transfer from ${transfer.from_branch.branch_name} to ${transfer.to_branch.branch_name} requires approval.`,
      type: "transferStock",
      pageLink: `/stockTransfer/approve/${transfer._id}`,
      requiresApproval: true,
      isDismissed: false,
      isApproved: false,
      isIgnored: false,
      metadata: null,
      branch: transfer.to_branch._id
    });
  }
};
