const express = require("express");
const router = express.Router();


// CONNECTING MODELS 
const User = require("../model/User");
const Supplier = require("../model/Supplier");
const Category = require("../model/Category");
const Branch = require("../model/Branch");
const Product = require("../model/Product");
const SupplierInvoice = require('../model/supplierInvoice');
const Customer = require('../model/Customer'); 
const StockTransfer = require('../model/transferStock');
const Loan = require('../model/Loan');
const ReceivedStock = require('../model/ReceivedStock');


// RECEIVE STOCK QUERY 
// Route: GET /search-stock?q=
router.get('/search-stock', async (req, res) => {
  const q = req.query.q;

  try {
    const products = await Product.find({
      product: { $regex: q, $options: 'i' }
    });

    const suggestions = products.map(prod => {
      const defaultVariant = prod.variants?.[0] || {};
      return {
        id: prod._id,
        name: prod.product,
        supplierPrice: defaultVariant.supplierPrice || ""
      };
    });

    res.json(suggestions);
  } catch (err) {
    console.error('Autocomplete fetch failed:', err);
    res.status(500).json([]);
  }
});

  



// PRODUCT QUERY 
router.get('/search-product', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);
  
    try {
      const products = await Product.find({
        product: { $regex: query, $options: "i" }
      }).limit(10); // Limit results
  
      // Add available_qty field to the response by summing quantities of variants
      const productsWithAvailableQty = products.map(product => {
        const available_qty = product.variants.reduce((sum, variant) => sum + variant.quantity, 0);
        return { ...product.toObject(), available_qty };
      });
  
      res.json(productsWithAvailableQty);
    } catch (error) {
      console.error('Error searching products:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  
router.get('/searchProduct-details', (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'Product name is required' });

  // Search for the product by exact name
  Product.findOne({ product: name })
    .populate('category') // populate category if needed for dropdown
    .then(product => {
      if (!product) return res.status(404).json({ error: 'Product not found' });
      res.json(product);
    })
    .catch(err => {
      console.error('Error fetching product details:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
});


// CUSTOMER TRANSACTIONS QUERY 
router.get('/api/searchCustomers', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const searchQuery = req.query.q;

  User.findById(req.user._id)
    .then(user => {
      if (!user) return res.status(401).json({ message: "User not found" });

      const branchId = user.branch;

      Customer.find({
        customer_name: { $regex: searchQuery, $options: 'i' },
        branch: branchId
      })
        .then(customers => {
          const updatedCustomers = customers.map(customer => {
            let total_amount = 0;
            let paid_amount = 0;

            customer.transactions.forEach(txn => {
              total_amount += txn.total || 0;
              paid_amount += txn.paid_amount || 0;
            });

            return {
              _id: customer._id,
              customer_name: customer.customer_name,
              mobile: customer.mobile,
              email: customer.email,
              address: customer.address,
              total_amount,
              paid_amount,
              total_debt: customer.total_debt || 0  // ✅ Use stored total_debt
            };
          });

          res.json(updatedCustomers);
        })
        .catch(err => {
          console.error('Error searching customers:', err);
          res.status(500).send('Internal Server Error');
        });
    })
    .catch(err => {
      console.error('Error fetching user:', err);
      res.status(500).send('Internal Server Error');
    });
});


// CUSTOMER INVOICE QUERY 
router.get("/search-customers", (req, res) => {
  const search = req.query.q;

  if (!search) return res.json([]);

  const regex = new RegExp(search, "i");

  // Ensure that only customers from the logged-in user's branch are fetched
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        const branchId = user.branch._id || user.branch;  // Get the branch of the logged-in user

        // Search customers only in the logged-in user's branch
        Customer.find({ 
          customer_name: { $regex: regex },
          branch: branchId  // Filter by branch
        })
          .limit(10) // Limit for performance
          .then(results => res.json(results))
          .catch(error => {
            console.error("Search error:", error);
            res.status(500).json({ error: "Server Error" });
          });
      })
      .catch(error => {
        console.error("Error fetching user:", error);
        res.status(500).json({ error: "Server Error" });
      });
  } else {
    res.redirect("/sign-in");
  }
});

  

// /routes/api.js or wherever your routes are
router.get('/api/searchLoaners', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const query = req.query.q;
  try {
    const loans = await Loan.find({
      loaner: { $regex: query, $options: 'i' }
    });

    const results = loans.map(l => {
      const total_to_repay = l.loans.reduce((sum, loan) => sum + (loan.amount_to_repay || 0), 0);
      return {
        _id: l._id,
        name: l.loaner, // this is important for the frontend
        mobile: l.mobile,
        address: l.address,
        total_to_repay
      };
    });

    res.json(results); // ✅ return an array
  } catch (err) {
    console.error('Loaner search failed:', err);
    res.status(500).json({ message: "Server error" }); // ✅ safe error response
  }
});


module.exports = router;