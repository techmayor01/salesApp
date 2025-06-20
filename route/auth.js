const express = require("express");

const router = express.Router();

const Chart = require('chart.js/auto');

const session = require("express-session");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;

const fs = require('fs');
const path = require('path')
const multer = require('multer');
const moment = require('moment');
const numberToWords = require('number-to-words');
const mongoose = require("mongoose");


const bcrypt = require("bcrypt");
const saltRounds = 10;

router.use(session({
    secret: "TOP_SECRET",
    resave: false,
    saveUninitialized: true
}));

router.use(passport.initialize());
router.use(passport.session());


// MULTER CONFIGURATION
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/media/uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    },
})

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png/;
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype;
  if (allowedTypes.test(ext) && allowedTypes.test(mime)) {
    cb(null, true);
  } else {
    cb(new Error('Only .jpeg, .jpg, .png files are allowed'));
  }
};

const upload = multer({ 
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter

 })   // dest: 'uploads/';


// CONNECTING MODELS 
const User = require("../model/User");
const Supplier = require("../model/Supplier");
const Category = require("../model/Category");
const Branch = require("../model/Branch");
const Product = require("../model/Product");
const SupplierInvoice = require('../model/supplierInvoice');
const Customer = require('../model/Customer'); 
const TransferStock = require('../model/transferStock');
const Loan = require('../model/Loan');
const ReceivedStock = require('../model/ReceivedStock');
const Invoice = require('../model/Invoice');
const Expense = require('../model/Expense');
const ProductChangeLog = require("../model/ProductLog");
const StockLog = require("../model/StockLog");
const CashReceivable = require('../model/CashReceivable');
const StaffLog = require("../model/StaffLog");
const CustomerLedger = require('../model/CustomerLedger');
const ActiveDebt = require('../model/ActiveDebt');
const Config = require('../model/NegSales');
const SupplierLedger = require('../model/SupplierLedger');
const StockLedger = require('../model/StockLedger');
const Notification = require("../model/Notification");
const ParkingStore = require("../model/ParkingStore");
const ParkingStock = require("../model/ParkingStock");


router.get("/dashboard", async (req, res) => {
  if (!req.user) return res.redirect("/sign-in");

  const range = req.query.range || 'daily';
  const selectedBranchId = req.query.branchId;

  const today = moment().startOf('day');
  let startDate, endDate;

  if (range === 'daily') {
    startDate = today.toDate();
    endDate = moment(today).endOf('day').toDate();
  } else if (range === 'weekly') {
    startDate = moment(today).subtract(6, 'days').startOf('day').toDate();
    endDate = moment(today).endOf('day').toDate();
  } else if (range === 'monthly') {
    startDate = moment(today).startOf('month').toDate();
    endDate = moment(today).endOf('day').toDate();
  } else {
    startDate = today.toDate();
    endDate = moment(today).endOf('day').toDate();
  }

  try {
    // Find the user and populate branch
    const user = await User.findById(req.user._id).populate("branch");
    if (!user) return res.redirect("/sign-in");

    let branchToUseId;

    if (user.role === 'owner') {
      // Use selectedBranchId or user branch if none selected
      if (selectedBranchId && mongoose.Types.ObjectId.isValid(selectedBranchId)) {
        branchToUseId = new mongoose.Types.ObjectId(selectedBranchId);
      } else if (user.branch) {
        branchToUseId = user.branch._id;
      }
    } else {
      // For non-owner roles, always use user's branch
      branchToUseId = user.branch ? user.branch._id : null;
    }

    if (!branchToUseId) {
      // Render empty dashboard if no branch available
      return res.render("index", {
        user,
        ownerBranch: null,
        branches: [],
        suppliers: [],
        customers: [],
        dailySales: {
          totalSales: 0,
          totalCashSalesAmount: 0,
          totalCreditSales: 0,
          totalDebtorsPayment: 0
        },
        rangeLabel: range,
        rankings: {
          topCustomers: [],
          topSellingProducts: [],
          lowPerformingProducts: []
        },
        selectedBranchId: null
      });
    }

    // Function to get totals for branch (using ObjectId branchToUseId)
    async function getTotalsForBranch(branchId) {
      return Invoice.aggregate([
        {
          $match: {
            branch: branchId,
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: "$sales_type",
            totalAmount: { $sum: "$grand_total" },
            totalPaidAmount: { $sum: "$paid_amount" },
            totalRemainingAmount: { $sum: "$remaining_amount" }
          }
        }
      ]);
    }

    const ownerBranch = await Branch.findById(branchToUseId);
    const allBranches = await Branch.find();
    const suppliers = await Supplier.find();
    const customers = await Customer.find({ branch: branchToUseId });

    const totals = await getTotalsForBranch(branchToUseId);

    let totalCashSalesAmount = 0;
    let totalCreditSales = 0;
    let totalDebtorsPayment = 0;

    totals.forEach(r => {
      if (r._id === 'cash') totalCashSalesAmount = r.totalAmount;
      else if (r._id === 'credit') {
        totalCreditSales = r.totalAmount;
        totalDebtorsPayment = r.totalRemainingAmount;
      }
    });

    const totalSales = totalCashSalesAmount + totalCreditSales;

    // Now fetch rankings (top customers, top selling, low performing) similarly
    // For brevity, I keep your aggregation as is but using branchToUseId ObjectId

    const topCustomers = await Invoice.aggregate([
      { $match: { branch: branchToUseId, createdAt: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: "$customer_id",
          totalSpent: { $sum: "$grand_total" },
          visits: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: "customers",
          localField: "_id",
          foreignField: "_id",
          as: "customer"
        }
      },
      { $unwind: "$customer" },
      {
        $project: {
          totalSpent: 1,
          visits: 1,
          customer_name: "$customer.customer_name"
        }
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 5 }
    ]);

    const topSellingProducts = await Invoice.aggregate([
      { $match: { branch: branchToUseId, createdAt: { $gte: startDate, $lte: endDate } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product",
          totalQty: { $sum: "$items.qty" }
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product"
        }
      },
      { $unwind: "$product" },
      { $sort: { totalQty: -1 } },
      { $limit: 5 }
    ]);

    const lowPerformingProducts = await Invoice.aggregate([
      { $match: { branch: branchToUseId, createdAt: { $gte: startDate, $lte: endDate } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product",
          totalQty: { $sum: "$items.qty" }
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product"
        }
      },
      { $unwind: "$product" },
      { $sort: { totalQty: 1 } },
      { $limit: 5 }
    ]);

    res.render("index", {
      user,
      ownerBranch,
      branches: allBranches,
      suppliers,
      customers,
      dailySales: {
        totalSales,
        totalCashSalesAmount,
        totalCreditSales,
        totalDebtorsPayment
      },
      rangeLabel: range,
      rankings: {
        topCustomers,
        topSellingProducts,
        lowPerformingProducts
      },
      selectedBranchId: branchToUseId.toString()
    });

  } catch (err) {
    console.error("Dashboard error:", err);
    return res.redirect('/error-404');
  }
});





// ADD SUPPLIERS LOGIC 
router.get("/addSupplier", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  res.render("Suppliers/addSupplier", {
                    user: user,
                    ownerBranch: { branch: ownerBranch },
                    branches: allBranches
                  });
                })
                .catch(err => {
                  console.error(err);
                  res.redirect('/error-404');
                });
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
          res.render("Suppliers/addSupplier", {
            user: user,
            ownerBranch: { branch: user.branch }
          });
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});


router.get("/manageSuppliers", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/sign-in");
  }

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      // OWNER ROLE
      if (user.role === "owner") {
        Branch.findById(user.branch)
          .then(ownerBranch => {
            Branch.find()
              .then(allBranches => {
                Supplier.find({})
                  .then(suppliers => {
                    res.render("Suppliers/manageSuppliers", {
                      user: user,
                      ownerBranch: { branch: ownerBranch },
                      branches: allBranches,
                      suppliers: suppliers
                    });
                  })
                  .catch(err => {
                    console.error("Error fetching suppliers:", err);
                    res.redirect("/error-404");
                  });
              })
              .catch(err => {
                console.error(err);
                res.redirect("/error-404");
              });
          })
          .catch(err => {
            console.error(err);
            res.redirect("/error-404");
          });

      // STAFF OR OTHER ROLES
      } else {
        Supplier.find({})
          .then(suppliers => {
            res.render("Suppliers/manageSuppliers", {
              user: user,
              ownerBranch: { branch: user.branch },
              suppliers: suppliers,
              branches: [] // optional, or omit
            });
          })
          .catch(err => {
            console.error("Error fetching suppliers:", err);
            res.redirect("/error-404");
          });
      }
    })
    .catch(err => {
      console.error(err);
      res.redirect("/error-404");
    });
});

router.get("/editSuppliers/:id", (req, res) => {
 if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  Supplier.findById(req.params.id)
                      .populate({
                        path: 'supplierInvoice',
                        populate: {
                          path: 'branch' // populate branch inside supplierInvoice
                        }
                    })
                    .then(supplier => {
                      res.render("Suppliers/editSupplier", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        supplier
                      });
                    })
                    .catch(err => {
                      console.error("Error fetching categories:", err);
                      res.redirect("/error-404");
                    });
                })
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
           Supplier.findById(req.params.id)
            .populate({
              path: 'supplierInvoice',
              populate: {
                path: 'branch' // populate branch inside supplierInvoice
              }
            })
         .then(supplier => {
          res.render("Suppliers/editSupplier", {
            user: user,
            ownerBranch: { branch: user.branch },
            supplier
          });
        })
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});


router.post("/updateSupplier", (req, res) => {
  const updateData = {
    supplier: req.body.supplier,
    contact_person: req.body.contact_person,
    email: req.body.email,
    phone: req.body.phone
  };

  Supplier.findByIdAndUpdate(req.body.id, { $set: updateData }, { new: true })
    .then(updatedDocument => {
      console.log("Updated Document:", updatedDocument);
      res.redirect("/manageSuppliers");
    })
    .catch(err => {
      console.error("Error updating document:", err);
    });
});

  
router.post("/addSupplier", (req, res) => {
    const { supplier, contact_person, email, phone, address } = req.body;
    const newSupplier = new Supplier({
      supplier,
      contact_person,
      email,
      phone,
      address
    });
  
    newSupplier.save()
      .then(savedSupplier => {
        console.log("Supplier added:", savedSupplier);
        res.redirect("/manageSuppliers")
      })
      .catch(err => {
        console.error("Error adding supplier:", err);
        res.status(500).json({ message: "Failed to add supplier", error: err.message });
      });
});


router.get("/delete/:id", (req,res)=>{
  Supplier.findByIdAndDelete(req.params.id)
  .then(user =>{
      res.redirect("/manageSuppliers")
      console.log('user successfully deleted');
      
  })
  .catch(err => console.log(err))
  console.log(req.params);
  
})


// ADD CATEGORIES LOGIC 
router.get("/addCategories", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  res.render("Categories/addCategories", {
                    user: user,
                    ownerBranch: { branch: ownerBranch },
                    branches: allBranches
                  });
                })
                .catch(err => {
                  console.error(err);
                  res.redirect('/error-404');
                });
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
          res.render("Categories/addCategories", {
            user: user,
            ownerBranch: { branch: user.branch }
          });
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }

});

router.post("/addCategories", (req, res) => {
    const { category_name } = req.body;

    const newCategory = new Category({
      category_name
    });
  
    newCategory.save()
      .then(savedCategory => {
        console.log("Supplier added:", savedCategory);
        res.redirect("/manageCategories")
      })
      .catch(err => {
        console.error("Error adding supplier:", err);
        res.status(500).json({ message: "Failed to add supplier", error: err.message });
      });
});

router.get("/manageCategories", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  Category.find()
                    .then(Category => {
                      res.render("Categories/manageCategories", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        Category
                      });
                    })
                    .catch(err => {
                      console.error("Error fetching categories:", err);
                      res.redirect("/error-404");
                    });
                })
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
         Category.find()
         .then(Category => {
          res.render("Categories/manageCategories", {
            user: user,
            ownerBranch: { branch: user.branch },
            Category
          });
        })
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }

});

router.get("/deleteCategory/:id", (req,res)=>{
    Category.findByIdAndDelete(req.params.id)
    .then(user =>{
        res.redirect("/manageCategories")
        console.log('user successfully deleted');
        
    })
    .catch(err => console.log(err))
    console.log(req.params);
    
})

router.get("/editCategory/:id", (req, res) => {
   if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  Category.findById(req.params.id)
                    .then(Category => {
                      res.render("Categories/editCategory", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        Category
                      });
                    })
                    .catch(err => {
                      console.error("Error fetching categories:", err);
                      res.redirect("/error-404");
                    });
                })
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
         Category.findById(req.params.id)
         .then(Category => {
          res.render("Categories/editCategory", {
            user: user,
            ownerBranch: { branch: user.branch },
            Category
          });
        })
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});
router.post("/updateCategory", (req, res) => {
  const updateData = {
    category_name: req.body.category_name
  };
  Category.findByIdAndUpdate(req.body.id, { $set: updateData }, { new: true })
    .then(updatedDocument => {
      console.log("Updated Document:", updatedDocument);
      res.redirect("/manageCategories");
    })
    .catch(err => {
      console.error("Error updating document:", err);
    });
});


// ADD BRANCH LOGIC 
router.get("/addBranch", (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/sign-in");
  }

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");
      if (user.role !== 'owner') {
        return res.redirect("/unauthorized");
      }

      Branch.findById(user.branch)
        .then(ownerBranch => {
          Branch.find()
            .then(allBranches => {
              res.render("Warehouse/addBranch", {
                user: user,
                ownerBranch: { branch: ownerBranch },
                branches: allBranches
              });
            })
            .catch(err => {
              next(err);
            });
        })
        .catch(err => {
          next(err);
        });
    })
    .catch(err => {
      next(err);
    });
});

router.post("/addBranch", (req, res, next) => {
  const { branch_name, branch_address, branch_phone } = req.body;
  Branch.findOne({ branch_name: branch_name })
    .then(existingBranch => {
      if (existingBranch) {
        return next(new Error("Branch name already exists."));
      }

      const newBranch = new Branch({
        branch_name,
        branch_address,
        branch_phone
      });

      return newBranch.save();
    })
    .then(savedBranch => {
      if (savedBranch) {
        res.redirect("/manageBranch");
      }
    })
    .catch(err => {
      next(err);
    });
});



router.get("/manageBranch", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        Category.find()
          .then(categories => {
            // Owner or admin: show all branches
            if (user.role === 'owner' || user.role === 'admin') {
              Branch.findById(user.branch)
                .then(ownerBranch => {
                  Branch.find()
                    .populate({
                      path: 'stock',
                      populate: { path: 'category' }
                    })
                    .then(allBranches => {
                      res.render("Warehouse/manageBranch", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        Category: categories
                      });
                    })
                    .catch(err => {
                      console.error("Error fetching all branches:", err);
                      res.redirect("/error-404");
                    });
                })
                .catch(err => {
                  console.error("Error fetching owner branch:", err);
                  res.redirect("/error-404");
                });
            } else {
              // Staff: show all branches too, but restrict edit/delete in view
              Branch.find()
                .populate({
                  path: 'stock',
                  populate: { path: 'category' }
                })
                .then(allBranches => {
                  res.render("Warehouse/manageBranch", {
                    user: user,
                    ownerBranch: { branch: user.branch },
                    branches: allBranches,
                    Category: categories
                  });
                })
                .catch(err => {
                  console.error("Error fetching branches for staff:", err);
                  res.redirect("/error-404");
                });
            }
          })
          .catch(err => {
            console.error("Error fetching categories:", err);
            res.redirect("/error-404");
          });
      })
      .catch(err => {
        console.error("Error fetching user:", err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});

router.get("/editBranch/:id", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      if (user.role === 'owner' || user.role === 'admin') {
        // First, find the branch to edit
        Branch.findById(req.params.id)
          .then(branch => {
            if (!branch) return res.redirect("/error-404");

            // Then, get all branches for the dropdown
            Branch.find()
              .then(allBranches => {
                res.render("Warehouse/editBranch", {
                  user: user,
                  branch: branch,         // The branch being edited
                  branches: allBranches   // For the dropdown in header
                });
              })
              .catch(err => {
                console.error("Error fetching all branches:", err);
                res.redirect("/error-404");
              });
          })
          .catch(err => {
            console.error("Error fetching branch to edit:", err);
            res.redirect("/error-404");
          });
      } else {
        res.redirect("/unauthorized");
      }
    })
    .catch(err => {
      console.error("Error fetching user:", err);
      res.redirect("/error-404");
    });
});

router.post("/updateBranch", (req, res) => {
  const updateData = {
    branch_name: req.body.branch_name,
    branch_address: req.body.branch_address
  };

  Branch.findByIdAndUpdate(req.body.id, { $set: updateData }, { new: true })
    .then(updatedDocument => {
      console.log("Updated Document:", updatedDocument);
      res.redirect("/manageBranch");
    })
    .catch(err => {
      console.error("Error updating document:", err);
    });
  });


router.get("/deleteBranch/:id", (req,res)=>{
    Branch.findByIdAndDelete(req.params.id)
    .then(user =>{
        res.redirect("/manageBranch")
        console.log('user successfully deleted');
        
    })
    .catch(err => console.log(err))
    console.log(req.params);
    
})

router.get("/viewBranch/:id", (req,res)=>{

  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  Branch.findById(req.params.id)
                       .populate({
                          path: 'stock',
                          populate: {
                            path: 'category' // populate branch inside supplierInvoice
                          }
                        })
                    .then(stock => {
                      res.render("Warehouse/viewBranch", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        stock
                      });
                    })
                    .catch(err => {
                      console.error("Error fetching categories:", err);
                      res.redirect("/error-404");
                    });
                })
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
            Branch.findById(req.params.id)
             .populate({
                path: 'stock',
                populate: {
                  path: 'category' // populate branch inside supplierInvoice
                }
              })
         .then(stock => {
          res.render("Warehouse/viewBranch", {
            user: user,
            ownerBranch: { branch: user.branch },
            stock
          });
        })
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
  console.log(req.params);
})





// ADD INVOICE LOGIC 
router.get("/addSupplierInvoice", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  Supplier.find()
                    .then(suppliers => {
                      res.render("SuppliersInvoice/addInvoice", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        suppliers
                      });
                    })
                    .catch(err => {
                      console.error("Error fetching categories:", err);
                      res.redirect("/error-404");
                    });
                })
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
         Supplier.find()
         .then(suppliers => {
          res.render("SuppliersInvoice/addInvoice", {
            user: user,
            ownerBranch: { branch: user.branch },
            suppliers
          });
        })
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});


router.post('/addinvoiceSuppliers', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/sign-in');

  User.findById(req.user._id)
    .then(user => {
      if (!user || !user.branch) {
        return res.status(400).send('User or user branch not found.');
      }

      const {
        supplier,
        invoice_type, // 'debit' or 'credit'
        amount,
        payment_date,
        reason
      } = req.body;

      const newInvoice = new SupplierInvoice({
        supplier,
        branch: user.branch,
        invoice_type,
        amount,
        payment_date,
        reason,
        created_by: user._id      
      });

      return newInvoice.save()
        .then((savedInvoice) => {
          return Supplier.findByIdAndUpdate(
            supplier,
            { $push: { supplierInvoice: savedInvoice._id } },
            { new: true }
          ).then(() => savedInvoice);
        })
        .then((savedInvoice) => {
          return Branch.findByIdAndUpdate(
            user.branch,
            { $push: { supplier_invoice: savedInvoice._id } },
            { new: true }
          ).then(() => savedInvoice);
        })
        .then((savedInvoice) => {
          // Now add Supplier Ledger entry
          return SupplierLedger.find({ supplier, branch: user.branch })
            .sort({ createdAt: -1 })
            .limit(1)
            .then(([lastLedger]) => {
              const prevBalance = lastLedger ? lastLedger.balance : 0;
              const newBalance = invoice_type === 'debit'
                ? prevBalance + Number(amount)
                : prevBalance - Number(amount);

              const ledgerEntry = new SupplierLedger({
                supplier,
                branch: user.branch,
                type: invoice_type,
                date: new Date(payment_date),
                amount: Number(amount),
                balance: newBalance,
                reason
              });

              return ledgerEntry.save();
            });
        })
        .then(() => {
          res.redirect('/SuppliersInvoice');
        });
    })
    .catch(err => {
      console.error('Error processing supplier invoice:', err);
      res.status(500).send('Internal Server Error');
    });
});


// GET all supplier invoices
router.get('/SuppliersInvoice', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      if (user.role === 'owner') {
        Branch.findById(user.branch)
          .then(ownerBranch => {
            Branch.find()
              .then(allBranches => {
                SupplierInvoice.find()
                  .populate('supplier branch created_by')
                  .then(invoices => {
                    res.render("SuppliersInvoice/invoiceList", {
                      user: user,
                      ownerBranch: { branch: ownerBranch },
                      branches: allBranches,
                      invoices
                    });
                  })
                  .catch(err => {
                    console.error("Error fetching invoices:", err);
                    res.redirect("/error-404");
                  });
              })
              .catch(err => {
                console.error("Error fetching branches:", err);
                res.redirect("/error-404");
              });
          })
          .catch(err => {
            console.error("Error fetching owner branch:", err);
            res.redirect('/error-404');
          });

      } else {
        SupplierInvoice.find({ branch: user.branch._id })
          .populate('supplier branch created_by') 
          .then(invoices => {
            res.render("SuppliersInvoice/invoiceList", {
              user: user,
              ownerBranch: { branch: user.branch },
              invoices
            });
          })
          .catch(err => {
            console.error("Error fetching invoices:", err);
            res.redirect("/error-404");
          });
      }
    })
    .catch(err => {
      console.error("Error fetching user:", err);
      res.redirect("/error-404");
    });
});


router.get("/delete/supplierInvoice/:id", (req,res)=>{
  SupplierInvoice.findByIdAndDelete(req.params.id)
  .then(user =>{
      res.redirect("/SuppliersInvoice")
      console.log('user successfully deleted');
      
  })
  .catch(err => console.log(err))
  console.log(req.params);
  
})

router.post("/update/supplierInvoice", async (req, res, next) => {
  try {
    const updateData = {
      invoice_type: req.body.invoice_type,
      amount: req.body.amount,
      payment_date: req.body.payment_date,
      reason: req.body.Adjustreason
    };

    const updatedDocument = await SupplierInvoice.findByIdAndUpdate(
      req.body.invoiceId,
      { $set: updateData },
      { new: true }
    );

    if (!updatedDocument) {
      const error = new Error("Invoice not found.");
      error.status = 404;
      return next(error);
    }

    console.log("Updated Document:", updatedDocument);
    res.redirect("/SuppliersInvoice");
  } catch (err) {
    next(err);
  }
});












// ADD PRODUCT LOGIC 

router.get("/addProduct", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  Supplier.find()
                    .then(suppliers => {
                      Category.find()
                      .then(categories =>{
                        res.render("Product/addProduct", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        suppliers,
                        categories
                      })
                     
                      });
                    })
                    .catch(err => {
                      console.error("Error fetching categories:", err);
                      res.redirect("/error-404");
                    });
                })
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
           Supplier.find()
          .then(suppliers => {
            Category.find()
            .then(categories =>{
              res.render("Product/addProduct", {
              user: user,
              ownerBranch: { branch: user.branch },
              suppliers,
              categories
            })
           
            });
          })
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});
  

router.post("/addProduct", upload.single("product_image"), (req, res, next) => {
  const {
    product,
    category,
    branch,
    product_detail,
    mfgDate,
    expDate,
    quantity,
    unitCode,
    lowStockAlert,
    supplierPrice,
    sellPrice
  } = req.body;

  const quantities = Array.isArray(quantity) ? quantity.map(Number) : [Number(quantity)];
  const unitCodes = Array.isArray(unitCode) ? unitCode : [unitCode];
  const lowStockAlerts = Array.isArray(lowStockAlert) ? lowStockAlert.map(Number) : [Number(lowStockAlert)];
  const sellPrices = Array.isArray(sellPrice) ? sellPrice.map(Number) : [Number(sellPrice)];
  const supplierPriceNum = Number(supplierPrice);
  const totalWorth = quantities[0] * supplierPriceNum;

  const variants = [];

  variants.push({
    quantity: quantities[0],
    unitCode: unitCodes[0],
    lowStockAlert: lowStockAlerts[0],
    sellPrice: sellPrices[0],
    totalWorth,
    totalPotentialRevenue: quantities[0] * sellPrices[0],
    actualRevenue: 0
  });

  for (let i = 1; i < quantities.length; i++) {
    const qty = quantities[i];
    const baseQty = quantities[0] * qty;
    const revenue = baseQty * sellPrices[i];

    variants.push({
      quantity: baseQty,
      unitCode: unitCodes[i],
      lowStockAlert: lowStockAlerts[i],
      sellPrice: sellPrices[i],
      totalInBaseUnit: qty,
      totalWorth: baseQty * supplierPriceNum,
      totalPotentialRevenue: revenue,
      actualRevenue: 0
    });
  }

  Product.findOne({ product, branch })
    .then(existingProduct => {
      if (existingProduct) {
        return next(new Error("Product name already exists for this branch."));
      }

      const newProduct = new Product({
        product,
        category,
        product_detail,
        mfgDate,
        expDate,
        branch,
        product_image: req.file ? req.file.filename : null,
        supplierPrice: supplierPriceNum,
        variants
      });

      return newProduct.save();
    })
    .then(savedProduct => {
      if (!savedProduct) return;

      return Branch.findByIdAndUpdate(
        branch,
        { $addToSet: { stock: savedProduct._id } },
        { new: true }
      );
    })
    .then(updatedBranch => {
      if (updatedBranch) {
        res.redirect("/addProduct");
      }
    })
    .catch(err => {
      next(err);
    });
});

router.get('/api/product/:id', (req, res) => {
  Product.findById(req.params.id)
    .then(product => {
      if (!product) return res.status(404).json({ message: 'Product not found' });
      res.json(product);
    })
    .catch(err => res.status(500).json({ message: 'Server error', error: err.message }));
});

router.post("/adjustStock", upload.single("product_image"), (req, res) => {
  const { productId, productName, adjustmentReason, variants: variantsRaw } = req.body;
  let variants = [];

  try {
    variants = JSON.parse(variantsRaw || "[]");
  } catch (e) {
    return res.status(400).json({ error: "Invalid variants JSON" });
  }

  if (!productId) {
    return res.status(400).json({ error: "Product ID is required" });
  }

  Product.findById(productId)
    .then(product => {
      if (!product) return Promise.reject({ status: 404, message: "Product not found" });

      const userId = req.user ? req.user._id : null;
      const stockLogs = [];

      // Check product name change
      if (productName && productName !== product.product) {
        stockLogs.push({
          productId: product._id,
          field: "productName",
          oldValue: product.product,
          newValue: productName,
          changedAt: new Date(),
          reason: adjustmentReason || "Product name changed",
          userId,
        });
        product.product = productName;
      }

      // Check image change
      if (req.file) {
        if (product.product_image !== req.file.filename) {
          stockLogs.push({
            productId: product._id,
            field: "product_image",
            oldValue: product.product_image,
            newValue: req.file.filename,
            changedAt: new Date(),
            reason: adjustmentReason || "Product image changed",
            userId,
          });
          product.product_image = req.file.filename;
        }
      }

      const oldVariantsMap = new Map();
      product.variants.forEach(v => oldVariantsMap.set(v.unitCode, v));

      const newVariantsMap = new Map();
      variants.forEach(v => {
        if (v.unitCode && v.unitCode.trim() !== "") {
          newVariantsMap.set(v.unitCode, v);
        }
      });

      // Detect deleted variants (in old but missing in new)
      oldVariantsMap.forEach((oldV, unitCode) => {
        if (!newVariantsMap.has(unitCode)) {
          stockLogs.push({
            productId: product._id,
            field: `variants[${unitCode}]`,
            oldValue: oldV,
            newValue: null,
            changedAt: new Date(),
            reason: adjustmentReason || `deleted ${unitCode}`,
            userId,
          });
        }
      });

      // Detect new or updated variants
      const newVariants = [];

      newVariantsMap.forEach((newV, unitCode) => {
        const oldV = oldVariantsMap.get(unitCode);
        const isNewVariant = !oldV;

        if (isNewVariant) {
          // New variant added - log whole variant once
          stockLogs.push({
            productId: product._id,
            field: `variants[${unitCode}]`,
            oldValue: null,
            newValue: newV,
            changedAt: new Date(),
            reason: adjustmentReason || "New variant added",
            userId,
          });
          newVariants.push(newV);
        } else {
          // Existing variant - check if any field changed (shallow compare)
          const changed = ["quantity", "lowStockAlert", "totalInBaseUnit", "supplierPrice", "sellPrice"].some(field => {
            return oldV[field] !== newV[field];
          });

          if (changed) {
            // Log full variant as newValue
            stockLogs.push({
              productId: product._id,
              field: `variants[${unitCode}]`,
              oldValue: oldV,
              newValue: newV,
              changedAt: new Date(),
              reason: adjustmentReason || `Variant ${unitCode} updated`,
              userId,
            });
          }
          newVariants.push(newV);
        }
      });

      product.variants = newVariants;

      return product.save()
        .then(updatedProduct => {
          if (stockLogs.length === 0) return updatedProduct;
          return StockLog.insertMany(stockLogs)
            .then(() => updatedProduct);
        });
    })
    .then(updatedProduct => {
      res.json({ message: "Product updated successfully", product: updatedProduct });
    })
    .catch(err => {
      if (err.status && err.message) return res.status(err.status).json({ error: err.message });
      console.error("Error updating product:", err);
      res.status(500).json({ error: "Internal server error" });
    });
});




router.get("/stockLogs", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  // === START LOGIC FOR STOCK LOGS ===
                  const { range, productId, userId, field } = req.query;
                  const now = new Date();
                  let startDate;

                  if (range === "day") {
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  } else if (range === "week") {
                    startDate = new Date();
                    startDate.setDate(startDate.getDate() - 7);
                  } else if (range === "month") {
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                  } else {
                    startDate = new Date(0);
                  }

                  const baseFilter = {
                    changedAt: { $gte: startDate, $lte: now },
                    oldValue: { $ne: null },
                    newValue: { $ne: null },
                    $expr: { $ne: ["$oldValue", "$newValue"] }  // Ensures only true updates
                  };
                  if (productId) baseFilter.productId = productId;
                  if (userId) baseFilter.userId = userId;
                  if (field) baseFilter.field = field;

                  StockLog.find(baseFilter)
                    .populate("productId userId")
                    .sort({ changedAt: -1 })
                    .then(logs => {
                      res.render("Product/stockLog", {
                        user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        logs,
                        range: range || "all"
                      });
                    })
                    .catch(err => {
                      console.error("Error fetching stock logs:", err);
                      res.redirect("/error-404");
                    });
                  // === END LOGIC FOR STOCK LOGS ===
                })
                .catch(err => {
                  console.error("Error fetching branches:", err);
                  res.redirect("/error-404");
                });
            })
            .catch(err => {
              console.error("Error finding owner branch:", err);
              res.redirect("/error-404");
            });
        } else {
          res.redirect("/unauthorized");
        }
      })
      .catch(err => {
        console.error("Error finding user:", err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});















router.get("/manageProduct", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  const selectedBranchId = req.query.branchId;

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      // OWNER can select any branch
      if (user.role === 'owner') {
        Branch.find()
          .then(allBranches => {
            const branchToFilter = selectedBranchId || user.branch._id;

            Product.find({ branch: branchToFilter })
              .populate('category')
              .populate('branch')
              .populate('variants.supplier')
              .then(products => {
                res.render("Product/manageProduct", {
                  user,
                  ownerBranch: { branch: user.branch },
                  branches: allBranches,
                  selectedBranchId: branchToFilter,
                  products
                });
              });
          });
      } else {
        // ADMIN or STAFF: only their own branch
        Product.find({ branch: user.branch._id })
          .populate('category')
          .populate('branch')
          .populate('variants.supplier')
          .then(products => {
            res.render("Product/manageProduct", {
              user,
              ownerBranch: { branch: user.branch },
              branches: [user.branch],
              selectedBranchId: user.branch._id,
              products
            });
          });
      }
    })
    .catch(err => {
      console.error(err);
      res.redirect("/error-404");
    });
});


router.get("/stockTransfer", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  const selectedBranchId = req.query.branchId;

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      // OWNER: Can choose any branch
      if (user.role === 'owner') {
        Branch.findById(user.branch)
          .then(ownerBranch => {
            Branch.find()
              .then(allBranches => {
                const branchToFilter = selectedBranchId || ownerBranch._id;

                Product.find({ branch: branchToFilter })
                  .populate('variants.supplier')
                  .populate('branch')
                  .then(products => {
                    res.render("Product/stockTransfer", {
                      user,
                      ownerBranch: { branch: ownerBranch },
                      branches: allBranches,
                      selectedBranchId: branchToFilter,
                      products
                    });
                  })
                  .catch(productErr => {
                    console.error(productErr);
                    res.status(500).send("Error fetching products.");
                  });
              })
              .catch(branchErr => {
                console.error(branchErr);
                res.status(500).send("Error fetching branches.");
              });
          })
          .catch(err => {
            console.error(err);
            res.status(500).send("Error fetching owner branch.");
          });
      } else {
        // ADMIN or STAFF: only their own branch
        Product.find({ branch: user.branch._id })
          .populate('variants.supplier')
          .populate('branch')
          .then(products => {
            Branch.find()
              .then(allBranches => {
                res.render("Product/stockTransfer", {
                  user,
                  ownerBranch: { branch: user.branch },
                  branches: allBranches,
                  selectedBranchId: user.branch._id,
                  products
                });
              })
              .catch(branchErr => {
                console.error(branchErr);
                res.status(500).send("Error fetching branches.");
              });
         
          })
         
      }
    })
    .catch(err => {
      console.error(err);
      res.status(500).send("Error finding user.");
    });
});




router.get("/adjustStock", (req,res)=>{
  
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  const selectedBranchId = req.query.branchId;

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      // OWNER can select any branch
      if (user.role === 'owner') {
        Branch.find()
          .then(allBranches => {
            const branchToFilter = selectedBranchId || user.branch._id;

            Product.find({ branch: branchToFilter })
              .populate('category')
              .populate('branch')
              .populate('variants.supplier')
              .then(products => {
                res.render("Product/stockAdjust", {
                  user,
                  ownerBranch: { branch: user.branch },
                  branches: allBranches,
                  selectedBranchId: branchToFilter,
                  products
                });
              });
          });
      } else {
        // ADMIN or STAFF: only their own branch
        Product.find({ branch: user.branch._id })
          .populate('category')
          .populate('branch')
          .populate('variants.supplier')
          .then(products => {
            res.render("Product/stockAdjust", {
              user,
              ownerBranch: { branch: user.branch },
              branches: [user.branch],
              selectedBranchId: user.branch._id,
              products
            });
          });
      }
    })
    .catch(err => {
      console.error(err);
      res.redirect("/error-404");
    });
})

router.get("/edit-single-stock/:id", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  const selectedBranchId = req.query.branchId;

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      if (user.role === 'owner') {
        Branch.find()
          .then(allBranches => {
            const branchToFilter = selectedBranchId || user.branch._id;

            Product.findById(req.params.id)
              .populate("category")
              .populate("branch")
              .populate("variants.supplier")
              .then(product => {
                if (!product) return res.redirect("/error-404");

                res.render("Product/edit-singleStock", {
                  user,
                  ownerBranch: { branch: user.branch },
                  branches: allBranches,
                  selectedBranchId: branchToFilter,
                  product
                });
              });
          });
      } else {
        // Admin/Staff: limited to their own branch
        Product.findById(req.params.id)
          .populate("category")
          .populate("branch")
          .populate("variants.supplier")
          .then(product => {
            if (!product) return res.redirect("/error-404");

            res.render("Product/edit-singleStock", {
              user,
              ownerBranch: { branch: user.branch },
              branches: [user.branch],
              selectedBranchId: user.branch._id,
              product
            });
          });
      }
    })
    .catch(err => {
      console.error("Error loading edit-single-stock:", err);
      res.redirect("/error-404");
    });
});

router.post("/update-single-stock", (req, res) => {
  const { productId, product, unitCodes = [], sellPrices = [] } = req.body;

  if (!productId || unitCodes.length === 0 || sellPrices.length === 0) {
    return res.status(400).send("Missing required fields");
  }

  Product.findById(productId)
    .then(prod => {
      if (!prod) return res.status(404).send("Product not found");

      if (product) prod.product = product;

      unitCodes.forEach((code, index) => {
        const variant = prod.variants.find(v => v.unitCode === code);
        if (variant && sellPrices[index] !== undefined && sellPrices[index] !== "") {
          variant.sellPrice = parseFloat(sellPrices[index]);
        }
      });

      return prod.save();
    })
    .then(() => {
      res.redirect("/adjustStock");
    })
    .catch(err => {
      console.error("Error updating stock:", err);
      res.status(500).send("Server error");
    });
});





router.get("/deleteProduct/:id", (req,res)=>{
    Product.findByIdAndDelete(req.params.id)
    .then(user =>{
        res.redirect("/manageProduct")
        console.log('user successfully deleted');
        
    })
    .catch(err => console.log(err))
    console.log(req.params);
    
})



router.get('/searchProduct', async (req, res) => {
  const { query } = req.query;
  const branchId = req.user.branch; // Logged-in user's branch

  if (!query || !branchId) {
    return res.status(400).json({ error: 'Missing query or branchId' });
  }

  try {
    // Find products that match query (case-insensitive) and belong to the user's branch
    // Assuming your Product schema has a branch field or something similar to filter by branch
    const products = await Product.find({
      product: { $regex: query, $options: 'i' },
      branch: branchId
    }).limit(10); // limit for performance

    // Return products array (empty if none found)
    res.json({ products });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});






router.post('/stockTransfer', (req, res) => {
  console.log("Received stock transfer request:", req.body);

  const {
    from_branch,
    to_branch,
    transaction_number,
    note,
    product,
    productId,
    unitCode,
    supplierPrice,
    sellPrice,
    quantity,
  } = req.body;

  // Normalize all to arrays
  const products = Array.isArray(product) ? product : [product];
  const productIds = Array.isArray(productId) ? productId : [productId];
  const unitCodes = Array.isArray(unitCode) ? unitCode : [unitCode];
  const supplierPrices = Array.isArray(supplierPrice) ? supplierPrice : [supplierPrice];
  const sellPrices = Array.isArray(sellPrice) ? sellPrice : [sellPrice];
  const quantities = Array.isArray(quantity) ? quantity : [quantity];

  let processedCount = 0;

  function processNextProduct() {
    if (processedCount >= productIds.length) {
      // All done, respond or redirect
      return res.redirect('/stockTransfer');
    }

    const currentProductId = productIds[processedCount];
    const currentUnitCode = unitCodes[processedCount];
    const currentQuantity = parseFloat(quantities[processedCount]);
    const currentSupplierPrice = parseFloat(supplierPrices[processedCount]);
    const currentSellPrice = parseFloat(sellPrices[processedCount]);

    Product.findById(currentProductId)
      .then(sourceProduct => {
        if (!sourceProduct) {
          throw new Error("Source product not found");
        }

        // Find base variant index by unitCode
        const baseIndex = sourceProduct.variants.findIndex(v => v.unitCode === currentUnitCode);
        if (baseIndex === -1) {
          throw new Error(`Base variant ${currentUnitCode} not found in source product`);
        }

        // Calculate quantities to subtract from each variant
        const baseQty = currentQuantity;

        // Subtract from source product variants according to their totalInBaseUnit
        sourceProduct.variants.forEach(variant => {
          const subtractQty = baseQty * (variant.totalInBaseUnit || 1);
          variant.quantity -= subtractQty;
          if (variant.quantity < 0) variant.quantity = 0; // Prevent negative stock
        });

        return sourceProduct.save()
          .then(() => {
            // Find or create destination product in the to_branch
            return Product.findOne({ product: sourceProduct.product, branch: to_branch })
              .then(destProduct => {
                if (destProduct) {
                  // Update variants in destination product
                  sourceProduct.variants.forEach(sourceVariant => {
                    const destVariant = destProduct.variants.find(v => v.unitCode === sourceVariant.unitCode);
                    const addQty = baseQty * (sourceVariant.totalInBaseUnit || 1);
                    if (destVariant) {
                      destVariant.quantity += addQty;
                    } else {
                      // Add new variant to dest product
                      destProduct.variants.push({
                        unitCode: sourceVariant.unitCode,
                        quantity: addQty,
                        lowStockAlert: sourceVariant.lowStockAlert,
                        sellPrice: sourceVariant.sellPrice,
                        totalInBaseUnit: sourceVariant.totalInBaseUnit || 1
                      });
                    }
                  });

                  // Update product-level supplierPrice and sellPrice
                  destProduct.supplierPrice = currentSupplierPrice;
                  destProduct.sellPrice = currentSellPrice;

                  return destProduct.save();
                } else {
                  // Create new product with variants adjusted
                  const newVariants = sourceProduct.variants.map(v => ({
                    unitCode: v.unitCode,
                    quantity: baseQty * (v.totalInBaseUnit || 1),
                    lowStockAlert: v.lowStockAlert,
                    sellPrice: v.sellPrice,
                    totalInBaseUnit: v.totalInBaseUnit || 1
                  }));

                  const newProduct = new Product({
                    product: sourceProduct.product,
                    category: sourceProduct.category,
                    branch: to_branch,
                    product_detail: sourceProduct.product_detail,
                    mfgDate: sourceProduct.mfgDate,
                    expDate: sourceProduct.expDate,
                    product_image: sourceProduct.product_image,
                    variants: newVariants,
                    supplierPrice: currentSupplierPrice,
                    sellPrice: currentSellPrice
                  });

                  return newProduct.save()
                    .then(saved => {
                      return Branch.findByIdAndUpdate(to_branch, { $push: { stock: saved._id } });
                    });
                }
              });
          });
      })
      .then(() => {
        processedCount++;
        processNextProduct();
      })
      .catch(err => {
        console.error("Error during stock transfer:", err);
        res.status(500).send(err.message || "Internal server error");
      });
  }

  processNextProduct();
});










router.get('/notifications', async (req, res) => {
  try {
    const user = req.user; // User must be authenticated
    let query = { isDismissed: false };

    if (user.role === 'staff') {
      query.branch = user.branch; // Only show notifications for staff's branch
    }

    // Owner sees all notifications
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(10);

    res.json(notifications);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});



// Approve
router.post('/notifications/approve/:id', async (req, res) => {
  await Notification.findByIdAndUpdate(req.params.id, { isApproved: true });
  res.sendStatus(200);
});

// Ignore
router.post('/notifications/ignore/:id', async (req, res) => {
  const { duration, unit } = req.body;
  const multiplier = { hours: 1, days: 24, months: 720 };
  const ignoreHours = parseInt(duration) * multiplier[unit];

  await Notification.findByIdAndUpdate(req.params.id, {
    isIgnored: true,
    ignoreUntil: new Date(Date.now() + ignoreHours * 60 * 60 * 1000)
  });

  res.sendStatus(200);
});




// EXPIRED PRODUCT LOGIC 
router.get("/expiredProducts", async (req, res) => {
  const currentDate = new Date();
  const selectedBranchId = req.query.branchId;

  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  try {
    const user = await User.findById(req.user._id).populate("branch");
    if (!user) return res.redirect("/sign-in");

    // OWNER ROUTE
    if (user.role === "owner") {
      const allBranches = await Branch.find();
      const branchToFilter = selectedBranchId || user.branch._id;

      const expiredProducts = await Product.find({
        branch: branchToFilter,
        expDate: { $lt: currentDate }
      }).populate("branch category variants.supplier");

      if (expiredProducts.length > 0) {
        const branch = allBranches.find(b => b._id.equals(branchToFilter));
        const existingNotification = await Notification.findOne({
          type: "expiredStock",
          pageLink: `/expiredProducts?branchId=${branch._id}`,
          isDismissed: false
        });

        if (!existingNotification) {
          await Notification.create({
            title: "Expired Stock Alert",
            description: `There are ${expiredProducts.length} expired product(s) at branch ${branch.branch_name}.`,
            type: "expiredStock",
            pageLink: `/expiredProducts?branchId=${branch._id}`
          });
        }
      }

      return res.render("ExpiredProducts/expiredProducts", {
        user,
        ownerBranch: { branch: user.branch },
        branches: allBranches,
        selectedBranchId: branchToFilter,
        expiredProducts
      });
    }

    // STAFF ROUTE
    const expiredProducts = await Product.find({
      branch: user.branch._id,
      expDate: { $lt: currentDate }
    }).populate("branch category variants.supplier");

    if (expiredProducts.length > 0) {
      const existingNotification = await Notification.findOne({
        type: "expiredStock",
        pageLink: `/expiredProducts?branchId=${user.branch._id}`,
        isDismissed: false
      });

      if (!existingNotification) {
        await Notification.create({
          title: "Expired Stock Alert",
          description: `You have ${expiredProducts.length} expired product(s) at branch ${user.branch.branch_name}.`,
          type: "expiredStock",
          pageLink: `/expiredProducts?branchId=${user.branch._id}`
        });
      }
    }

    return res.render("ExpiredProducts/expiredProducts", {
      user,
      ownerBranch: { branch: user.branch },
      branches: [user.branch],
      selectedBranchId: user.branch._id,
      expiredProducts
    });
  } catch (err) {
    console.error(err);
    res.redirect("/error-404");
  }
});

// DEAD PRODUCT LOGIC 
router.get("/DeadStockProducts", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  const selectedBranchId = req.query.branchId;
  const currentDate = new Date();
  const cutoffDate = new Date(currentDate.setMonth(currentDate.getMonth() - 1));

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      if (user.role === 'owner') {
        Branch.find()
          .then(allBranches => {
            const branchToFilter = selectedBranchId || user.branch._id;

            Product.find({
              branch: branchToFilter,
              created_at: { $lt: cutoffDate },
              "variants.quantity": { $gt: 0 }
            })
              .populate("branch category variants.supplier")
              .then(deadStockProducts => {
                res.render("DeadStockProducts/deadStockProducts", {
                  user,
                  ownerBranch: { branch: user.branch },
                  branches: allBranches,
                  selectedBranchId: branchToFilter,
                  deadStockProducts
                });
              });
          });
      } else {
        Product.find({
          branch: user.branch._id,
          created_at: { $lt: cutoffDate },
          "variants.quantity": { $gt: 0 }
        })
          .populate("branch category variants.supplier")
          .then(deadStockProducts => {
            res.render("DeadStockProducts/deadStockProducts", {
              user,
              ownerBranch: { branch: user.branch },
              branches: [user.branch],
              selectedBranchId: user.branch._id,
              deadStockProducts
            });
          });
      }
    })
    .catch(err => {
      console.error(err);
      res.redirect("/error-404");
    });
});



// ADD CUSTOMER LOGIC 
router.get("/addCustomers", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  res.render("Customers/addCustomers", {
                    user: user,
                    ownerBranch: { branch: ownerBranch },
                    branches: allBranches
                  });
                })
                .catch(err => {
                  console.error(err);
                  res.redirect('/error-404');
                });
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
          res.render("Customers/addCustomers", {
            user: user,
            ownerBranch: { branch: user.branch }
          });
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});


router.get("/manageCustomers", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  const selectedBranchId = req.query.branchId;

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      if (user.role === 'owner') {
        Branch.find()
          .then(allBranches => {
            const branchToFilter = selectedBranchId || user.branch._id;

            Customer.find({ branch: branchToFilter })
              .then(customers => {
                res.render("Customers/manageCustomers", {
                  user,
                  ownerBranch: { branch: user.branch },
                  branches: allBranches,
                  selectedBranchId: branchToFilter,
                  customers
                });
              })
              .catch(err => {
                console.error("Error fetching customers:", err);
                res.redirect("/error-404");
              });
          });
      } else {
        // Staff/Admin logic - show only their own branch
        Customer.find({ branch: user.branch._id })
          .then(customers => {
            res.render("Customers/manageCustomers", {
              user,
              ownerBranch: { branch: user.branch },
              branches: [user.branch],
              selectedBranchId: user.branch._id,
              customers
            });
          })
          .catch(err => {
            console.error("Error fetching customers:", err);
            res.redirect("/error-404");
          });
      }
    })
    .catch(err => {
      console.error("Error fetching user:", err);
      res.redirect("/error-404");
    });
});



router.get("/delete/customer/:id", (req,res)=>{
  Customer.findByIdAndDelete(req.params.id)
  .then(user =>{
      res.redirect("/manageCustomers")
      console.log('customer successfully deleted');
      
  })
  .catch(err => console.log(err))
  
})



router.post("/addCustomers", (req, res) => {
  const { customer_name, mobile, email, address, credit_limit } = req.body;

  if (!req.isAuthenticated()) {
    return res.redirect('/sign-in');
  }

  User.findById(req.user._id)
    .then(user => {
      if (!user) return res.redirect('/sign-in');

      const newCustomer = new Customer({
        customer_name,
        mobile,
        email,
        address,
        credit_limit,
        branch: user.branch
      });

      return newCustomer.save()
        .then(savedCustomer => {
          return Branch.findByIdAndUpdate(
            user.branch,
            { $push: { customers: savedCustomer._id } },
            { new: true }
          ).then(() => savedCustomer);
        });
    })
    .then(savedCustomer => {
      console.log("Customer saved and added to branch:", savedCustomer);
      res.redirect('/manageCustomers');
    })
    .catch(err => {
      console.error("Error adding customer:", err);
      res.status(500).send("Internal Server Error");
    });
});




router.get("/creditCustomers", async (req, res, next) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  try {
    const user = await User.findById(req.user._id).populate("branch");
    if (!user) return res.redirect("/sign-in");

    const branchId = user.branch._id; // Always use logged-in user's branch

    // 1. Get credit-type customers in user's branch
    const customers = await Customer.find({
      branch: branchId,
      sales_type: 'credit'
    }).populate("branch");

    const customerIds = customers.map(c => c._id);

    // 2. Find ActiveDebt entries for these customers with balance > 0 in this branch
    const activeDebts = await ActiveDebt.find({
      customer: { $in: customerIds },
      branch: branchId,
      total_balance: { $gt: 0 }
    }).populate("customer");

    // 3. Filter customers who have active debt
    const activeDebtCustomerIds = new Set(activeDebts.map(debt => debt.customer._id.toString()));
    const creditCustomers = customers.filter(c =>
      activeDebtCustomerIds.has(c._id.toString())
    );

    res.render("Customers/creditCustomers", {
      user,
      ownerBranch: { branch: user.branch },
      branches: [user.branch],
      selectedBranchId: branchId,
      customers: creditCustomers
    });

  } catch (err) {
    next(err);
  }
});






router.get("/paidCustomers", (req, res, next) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  const selectedBranchId = req.query.branchId;

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      const isOwner = user.role === 'owner';
      const branchToUse = selectedBranchId || user.branch._id;

      const loadBranches = isOwner
        ? Branch.find()
        : Promise.resolve([user.branch]);

      const loadBranchDetails = isOwner
        ? Branch.findById(user.branch)
        : Promise.resolve(user.branch);

      Promise.all([loadBranchDetails, loadBranches])
        .then(([ownerBranch, allBranches]) => {
          return Customer.find({ branch: branchToUse }).then(customers => {
            const paidCustomers = customers.filter(customer =>
              customer.sales_type === 'cash' &&
              Array.isArray(customer.transactions) &&
              customer.transactions.length > 0 &&
              customer.transactions.every(transaction => transaction.remaining_amount <= 0)
            );

            res.render("Customers/paidCustomers", {
              user,
              ownerBranch: { branch: ownerBranch },
              branches: allBranches,
              selectedBranchId: branchToUse,
              customers: paidCustomers
            });
          });
        })
        .catch(err => {
          console.error("Error loading branches or customers:", err);
          next(err);
        });
    })
    .catch(err => {
      console.error("Error loading user:", err);
      next(err);
    });
});





// TRANSACTION LOGIC 


router.get("/cashReceivable", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        const branchId = user.branch._id || user.branch;

        if (user.role === 'owner') {
          Branch.findById(branchId)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  Customer.find({ branch: branchId })  // 🔥 Filter by branch here
                    .then(customers => {
                      console.log("Customers:", customers);
                      
                      res.render("Transaction/cashReceivable", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        customers
                      });
                    })
                    .catch(err => {
                      console.error("Error fetching customers:", err);
                      res.redirect("/error-404");
                    });
                });
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
          Customer.find({ branch: branchId })  // 🔥 Filter for normal users too
            .then(customers => {
              res.render("Transaction/cashReceivable", {
                user: user,
                ownerBranch: { branch: user.branch },
                customers
              });
            });
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});

   
router.get("/transactionHistory", (req, res, next) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  const selectedBranchId = req.query.branchId;

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      if (user.role === 'owner') {
        Branch.find()
          .then(allBranches => {
            const branchToFilter = selectedBranchId || user.branch._id;

            // Find transactions only for the selected branch
            CashReceivable.find({ branch: branchToFilter })
              .populate('userId')
              .then(transactions => {
                res.render("Transaction/transactionHistory", {
                  user,
                  ownerBranch: { branch: user.branch },
                  branches: allBranches,
                  selectedBranchId: branchToFilter,
                  transactions
                });
              })
              .catch(err => {
                console.error("Error fetching transactions:", err);
                next(err);
              });
          })
          .catch(err => {
            console.error("Error fetching branches:", err);
            next(err);
          });
      } else {
        // Staff/Admin logic - show only their own branch transactions
        CashReceivable.find({ branch: user.branch._id })
          .populate('userId')
          .then(transactions => {
            res.render("Transaction/transactionHistory", {
              user,
              ownerBranch: { branch: user.branch },
              branches: [user.branch],
              selectedBranchId: user.branch._id,
              transactions
            });
          })
          .catch(err => {
            console.error("Error fetching transactions:", err);
            next(err);
          });
      }
    })
    .catch(err => {
      console.error("Error fetching user:", err);
      next(err);
    });
});


router.post('/cashReceivable', (req, res, next) => {
  const { selectedUserId, selectedUserType, amount, date, paymentType, reference } = req.body;

  if (!req.isAuthenticated()) {
    return res.redirect('/sign-in');
  }

  if (!selectedUserId || !selectedUserType || !amount || !date || !paymentType) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let branchDoc, generatedReceiptNo, savedCash;

  User.findById(req.user._id)
    .then(user => {
      if (!user) return res.redirect('/sign-in');
      const branchId = user.branch;

      return Branch.findById(branchId).then(branch => {
        if (!branch) throw { status: 404, message: 'Branch not found' };
        branchDoc = branch;

        const prefix = branch.branch_name.toUpperCase().slice(0, 2);
        const branchPrefix = `PAY-${prefix}-`;

        return CashReceivable.find({ receiptNo: { $regex: `^${branchPrefix}` } })
          .sort({ createdAt: -1 })
          .limit(1)
          .then(([latest]) => {
            let nextNum = 1;
            if (latest && latest.receiptNo) {
              const match = latest.receiptNo.match(/\d+$/);
              if (match) {
                nextNum = parseInt(match[0], 10) + 1;
              }
            }
            const paddedNum = String(nextNum).padStart(3, '0');
            generatedReceiptNo = `PAY-${prefix}-${paddedNum}`;
          });
      });
    })
    .then(() => {
      const amountPaid = Number(amount);
      const branchId = branchDoc._id;

      if (selectedUserType === 'customer') {
        return Customer.findById(selectedUserId)
          .then(customer => {
            if (!customer) return res.status(404).json({ error: 'Customer not found' });

            const expectedAmount = customer.total_debt || 0;
            const newRemaining = Math.max(0, expectedAmount - amountPaid);

            customer.total_debt = newRemaining;
            customer.remaining_amount = newRemaining;

            customer.transactions.push({
              product: 'Debt Repayment',
              qty: 0,
              rate: 0,
              total: expectedAmount,
              paid_amount: amountPaid,
              remaining_amount: newRemaining,
              date,
              paymentType,
              reference,
              branch: branchId
            });

            return customer.save()
              .then(() => {
                const cash = new CashReceivable({
                  receiptNo: generatedReceiptNo,
                  transactionType: 'Customer',
                  userId: customer._id,
                  expectedAmount,
                  amountReceived: amountPaid,
                  balanceRemaining: newRemaining,
                  paymentDate: new Date(date),
                  paymentType,
                  reference,
                  branch: branchId,
                  createdBy: req.user._id
                });

                return cash.save();
              })
              .then(cash => {
                savedCash = cash;

                const ledgerEntry = new CustomerLedger({
                  customer: cash.userId,
                  branch: branchId,
                  type: 'payment',
                  refNo: generatedReceiptNo,
                  date: new Date(date),
                  amount: amountPaid,
                  paid: amountPaid,
                  balance: cash.balanceRemaining
                });

                return ledgerEntry.save();
              })
              .then(() => {
                return ActiveDebt.findOne({ customer: selectedUserId, branch: branchId })
                  .then(activeDebt => {
                    if (!activeDebt) return;

                    let paymentLeft = amountPaid;

                    for (let i = 0; i < activeDebt.invoices.length && paymentLeft > 0; i++) {
                      const invoice = activeDebt.invoices[i];
                      const applyAmount = Math.min(invoice.balance, paymentLeft);
                      invoice.balance -= applyAmount;
                      paymentLeft -= applyAmount;
                    }

                    activeDebt.invoices = activeDebt.invoices.filter(inv => inv.balance > 0);
                    activeDebt.total_balance = activeDebt.invoices.reduce((sum, inv) => sum + inv.balance, 0);
                    activeDebt.lastUpdated = new Date();

                    if (activeDebt.total_balance === 0) {
                      return ActiveDebt.deleteOne({ _id: activeDebt._id });
                    } else {
                      return activeDebt.save();
                    }
                  });
              });
          });

      } else if (selectedUserType === 'loan') {
        return Loan.findById(selectedUserId)
          .then(loaner => {
            if (!loaner) return res.status(404).json({ error: 'Loaner not found' });

            const totalExpected = loaner.loans.reduce((sum, loan) => sum + loan.amount_to_repay, 0);
            const newRemaining = Math.max(0, totalExpected - amountPaid);

            if (loaner.loans.length > 0) {
              loaner.loans[0].amount_to_repay = newRemaining;
            }

            return loaner.save()
              .then(() => {
                const cash = new CashReceivable({
                  receiptNo: generatedReceiptNo,
                  transactionType: 'Loan',
                  userId: loaner._id,
                  expectedAmount: totalExpected,
                  amountReceived: amountPaid,
                  balanceRemaining: newRemaining,
                  paymentDate: new Date(date),
                  paymentType,
                  reference,
                  branch: branchDoc._id,
                  createdBy: req.user._id
                });

                return cash.save();
              })
              .then(cash => {
                savedCash = cash;
                return Promise.resolve(); // Ensure the chain continues
              });
          });
      } else {
        return res.status(400).json({ error: 'Invalid user type' });
      }
    })
    .then(() => {
      if (savedCash) {
        res.redirect(`/cash-receipt/${savedCash._id}`);
      } else {
        res.redirect('/transactionHistory');
      }
    })
    .catch(err => {
      console.error('Error in cashReceivable:', err);
      next(err);
    });
});

router.get("/deletetransactionHistory/:id", (req,res)=>{
  CashReceivable.findByIdAndDelete(req.params.id)
  .then(user =>{
      res.redirect("/transactionHistory")
      
  })
  .catch(err => console.log(err))
  
});

router.get("/api/customers/suggest", (req, res) => {
  const search = req.query.q || "";

  Customer.find({ customer_name: { $regex: search, $options: "i" } })
    .limit(10)
    .select("customer_name _id")
    .then(results => res.json(results))
    .catch(err => {
      console.error("Customer Suggest Error:", err);
      res.status(500).json({ error: "Server error while suggesting customers" });
    });
});


router.post("/settings/toggle-negative-sales", async (req, res) => {
  if (!req.isAuthenticated() || req.user.role !== 'owner') {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  try {
    let config = await Config.findOne({ key: "negativeSalesActive" });
    if (!config) {
      config = new Config({ key: "negativeSalesActive", value: true });
    } else {
      config.value = !config.value;
    }

    await config.save();

    res.json({ success: true, active: config.value });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

router.post("/update/transaction", async (req, res, next) => {
  try {
    console.log("Received update transaction request:", req.body);

    const {
      transactionId,
      customerName,
      transactionType,
      expectedAmount,
      amountReceived,
      balanceRemaining,
      paymentDate,
      adjustReason
    } = req.body;

    const transaction = await CashReceivable.findById(transactionId);
    if (!transaction) {
      return res.status(404).send("Transaction not found");
    }

    transaction.transactionType = transactionType;
    transaction.expectedAmount = Number(expectedAmount);
    transaction.amountReceived = Number(amountReceived);
    transaction.balanceRemaining = Number(balanceRemaining);
    transaction.paymentDate = new Date(paymentDate);
    transaction.adjustReason = adjustReason;

    if (transaction.userId && typeof transaction.userId === "object") {
      if (transactionType === "Loan") {
        transaction.userId.loaner = customerName;
      } else {
        transaction.userId.customer_name = customerName;
      }
    }

    await transaction.save();
    res.redirect("/transactionHistory");
  } catch (err) {
    next(err);
  }
});






// ADD CUSTOMER INVOICE LOGIC 
router.get("/addInvoice", (req, res, next) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        const branchId = user.branch._id || user.branch;

        const fetchCustomersAndProducts = (ownerBranch, allBranches) => {
          Promise.all([
            Customer.find({ branch: branchId }).sort({ createdAt: -1 }),
            Product.find({ branch: branchId }).sort({ createdAt: -1 }),
            Config.findOne({ key: "negativeSalesActive" })  // Fetch setting
          ])
            .then(([customers, products, config]) => {
              const negativeSalesActive = config?.value === true;

              res.render("Invoice/addInvoice", {
                user: user,
                ownerBranch: { branch: ownerBranch },
                branches: allBranches || [],
                customers: customers,
                products: products,
                negativeSalesActive: negativeSalesActive  // Pass to template
              });
            })
            .catch(err => {
              console.error("Error fetching invoice data:", err);
              next(err);
            });
        };

        if (user.role === 'owner') {
          Branch.findById(branchId)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  fetchCustomersAndProducts(ownerBranch, allBranches);
                })
                .catch(err => {
                  console.error("Error fetching branches:", err);
                  next(err);
                });
            })
            .catch(err => {
              console.error("Error fetching owner branch:", err);
              next(err);
            });
        } else {
          fetchCustomersAndProducts(user.branch);
        }
      })
      .catch(err => {
        console.error("Error fetching user:", err);
        next(err);
      });
  } else {
    res.redirect("/sign-in");
  }
});


router.post("/addInvoice", async (req, res, next) => {
  const roundToTwo = num => Math.round((num + Number.EPSILON) * 100) / 100;

  let {
    customer_id,
    customer_name,
    mobile,
    email,
    address,
    credit_limit,
    payment_date,
    sales_type,
    discount = 0,
    product,
    qty,
    unitcode,
    rate,
    total,
    payment_type,
    grand_total,
    paid_amount
  } = req.body;

  if (!Array.isArray(product)) product = [product];
  if (!Array.isArray(qty)) qty = [qty];
  if (!Array.isArray(unitcode)) unitcode = [unitcode];
  if (!Array.isArray(rate)) rate = [rate];
  if (!Array.isArray(total)) total = [total];

  const len = product.length;
  if (
    qty.length !== len ||
    unitcode.length !== len ||
    rate.length !== len ||
    total.length !== len
  ) {
    return next({ status: 400, message: 'Product detail arrays must have the same length' });
  }

  const branchId = req.user.branch;
  if (!branchId) {
    return next({ status: 400, message: 'Branch ID not found on user' });
  }

  const grandTotalNum = roundToTwo(Number(grand_total));
  const paidAmountNum = roundToTwo(Number(paid_amount));
  const remainingAmount = roundToTwo(grandTotalNum - paidAmountNum);

  const items = [];
  let branchDoc;
  let generatedInvoiceNo;
  let generatedReceiptNo;
  let savedInvoice;

  try {
    const branch = await Branch.findById(branchId);
    if (!branch) throw { status: 404, message: 'Branch not found' };
    branchDoc = branch;

    const prefix = branch.branch_name.toUpperCase().slice(0, 2);
    const branchPrefix = `INV-${prefix}-`;
    const receiptPrefix = `PAY-${prefix}-`;

    const latestInvoice = await Invoice.findOne({ invoice_no: { $regex: `^${branchPrefix}` } }).sort({ createdAt: -1 });
    let nextNum = 1;
    if (latestInvoice?.invoice_no) {
      const match = latestInvoice.invoice_no.match(/\d+$/);
      if (match) nextNum = parseInt(match[0], 10) + 1;
    }
    const paddedNum = String(nextNum).padStart(3, '0');
    generatedInvoiceNo = `INV-${prefix}-${paddedNum}`;

    const latestReceipt = await Invoice.findOne({ receipt_no: { $regex: `^${receiptPrefix}` } }).sort({ createdAt: -1 });
    let nextReceiptNum = 1;
    if (latestReceipt?.receipt_no) {
      const match = latestReceipt.receipt_no.match(/\d+$/);
      if (match) nextReceiptNum = parseInt(match[0], 10) + 1;
    }
    const paddedReceiptNum = String(nextReceiptNum).padStart(3, '0');
    generatedReceiptNo = `PAY-${prefix}-${paddedReceiptNum}`;

    const config = await Config.findOne({ key: "negativeSalesActive" });
    const negativeSalesActive = config?.value === true;

    for (let i = 0; i < len; i++) {
      const productName = product[i];
      if (!productName || productName.trim() === "") continue;

      const soldQtyRaw = Number(qty[i]);
      const unitCode = unitcode[i];
      const itemRate = roundToTwo(Number(rate[i]));
      const itemTotal = roundToTwo(Number(total[i]));
      const soldQty = Math.round(soldQtyRaw * 2) / 2;

      const productDoc = await Product.findOne({ product: productName });
      if (!productDoc) {
        console.warn(`Warning: Product not found: ${productName}, skipping`);
        continue;
      }

      const sellingVariant = productDoc.variants.find(v => v.unitCode === unitCode);
      if (!sellingVariant) {
        console.warn(`Warning: Unit variant not found for: ${productName}, skipping`);
        continue;
      }

      const firstVariant = productDoc.variants[0];
      const baseEquivalent = soldQty / (sellingVariant.totalInBaseUnit || 1);

      if (!negativeSalesActive && baseEquivalent > firstVariant.quantity) {
        throw {
          status: 400,
          message: `Insufficient stock for ${productName} in ${unitCode}.`
        };
      }

      firstVariant.quantity -= baseEquivalent;

      productDoc.variants.forEach((variant, idx) => {
        if (idx === 0) return;
        const factor = variant.totalInBaseUnit || 1;
        variant.quantity = firstVariant.quantity * factor;
      });

      items.push({
        product: productDoc._id,
        product_name: productName,
        qty: soldQty,
        unitcode: unitCode,
        rate: itemRate,
        total: itemTotal
      });

      await productDoc.save();

      const updatedVariants = productDoc.variants.map(v => ({
        unitCode: v.unitCode,
        stock_in: 0,
        stock_out: v.unitCode === unitCode ? soldQty : 0,
        balance: v.quantity
      }));

      const stockLedgerEntry = new StockLedger({
        product: productDoc._id,
        branch: branchId,
        date: new Date(payment_date),
        operator: req.user._id,
        variants: updatedVariants
      });

      await stockLedgerEntry.save();
    }

    // === SAVE INVOICE ===
    savedInvoice = await Invoice.create({
      customer_id,
      customer_name,
      mobile,
      email,
      address,
      credit_limit,
      payment_date,
      sales_type,
      discount,
      items,
      payment_type,
      grand_total: grandTotalNum,
      paid_amount: paidAmountNum,
      remaining_amount: remainingAmount,
      invoice_no: generatedInvoiceNo,
      receipt_no: generatedReceiptNo,
      user: req.user._id,
      branch: branchId,
      createdBy: req.user._id // ✅ required by schema
    });

    // === SUCCESS ===
    res.redirect(`/receipt/${savedInvoice._id}`);

  } catch (err) {
    console.error('AddInvoice error:', err);
    next(err);
  }
});





router.get('/receipt/:invoiceId', async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.invoiceId)
      .populate('branch')
      .populate('createdBy');

    if (!invoice) {
      return res.status(404).send('Invoice not found');
    }

    const branch = invoice.branch;
    const isHeadOffice = branch?.isHeadOffice;
    const creator = invoice.createdBy;

    const totalInWords = numberToWords.toWords(invoice.grand_total)
      .replace(/\b\w/g, l => l.toUpperCase());

    let headOffice = null;

    // ✅ Only find head office if current branch is NOT head office
    if (!isHeadOffice) {
      headOffice = await Branch.findOne({ isHeadOffice: true });
    }

    res.render('Invoice/receipt', {
      invoice,
      branch,
      creator,
      isHeadOffice,
      headOffice,
      totalInWords
    });

  } catch (err) {
    console.error('Error loading receipt:', err);
    next(err);
  }
});

router.get('/cash-receipt/:cashId', async (req, res, next) => {
  try {
    const cashReceipt = await CashReceivable.findById(req.params.cashId)
      .populate('branch')
      .populate('createdBy')
      .populate('userId');

    if (!cashReceipt) {
      return res.status(404).send('Receipt not found');
    }

    const branch = cashReceipt.branch;
    const isHeadOffice = branch?.isHeadOffice;
    const creator = cashReceipt.createdBy;

    const totalInWords = numberToWords.toWords(cashReceipt.amountReceived)
      .replace(/\b\w/g, l => l.toUpperCase());

    let headOffice = null;

    if (!isHeadOffice) {
      headOffice = await Branch.findOne({ isHeadOffice: true });
    }

    res.render('Transaction/receipt', {
      receipt: cashReceipt,
      branch,
      creator,
      customerOrLoan: cashReceipt.userId,
      isHeadOffice,
      headOffice,
      totalInWords
    });

  } catch (err) {
    next(err);
  }
});


router.get("/manageInvoice", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  const selectedBranchId = req.query.branchId;

  // Get start and end of today
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      const invoiceQuery = {
        branch: selectedBranchId || user.branch._id,
        createdAt: { $gte: startOfDay, $lte: endOfDay }
      };

      if (user.role === 'owner') {
        Branch.find()
          .then(allBranches => {
            Invoice.find(invoiceQuery)
              .populate('customer_id')
              .then(invoices => {
                res.render("Invoice/manageInvoice", {
                  user,
                  ownerBranch: { branch: user.branch },
                  branches: allBranches,
                  selectedBranchId: selectedBranchId || user.branch._id,
                  invoices
                });
              })
              .catch(err => {
                console.error("Error fetching invoices:", err);
                res.redirect("/error-404");
              });
          })
          .catch(err => {
            console.error("Error fetching branches:", err);
            res.redirect("/error-404");
          });
      } else {
        // For staff/admin, restrict to their branch
        Invoice.find({
          branch: user.branch._id,
          createdAt: { $gte: startOfDay, $lte: endOfDay }
        })
          .populate('customer_id')
          .then(invoices => {
            res.render("Invoice/manageInvoice", {
              user,
              ownerBranch: { branch: user.branch },
              branches: [user.branch],
              selectedBranchId: user.branch._id,
              invoices
            });
          })
          .catch(err => {
            console.error("Error fetching invoices:", err);
            res.redirect("/error-404");
          });
      }
    })
    .catch(err => {
      console.error("Error fetching user:", err);
      res.redirect("/error-404");
    });
});

 
router.get("/paidInvoice", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  const selectedBranchId = req.query.branchId;

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      if (user.role === "owner") {
        Branch.find()
          .then(allBranches => {
            const branchToFilter = selectedBranchId || (user.branch ? user.branch._id : null);
            if (!branchToFilter) {
              return res.render("Invoice/paidInvoice", { user, branches: allBranches, selectedBranchId: null, invoices: [] });
            }

            Invoice.find({ branch: branchToFilter, sales_type: "cash" })
              .populate("customer_id")
              .then(invoices => {
                res.render("Invoice/paidInvoice", {
                  user,
                  branches: allBranches,
                  selectedBranchId: branchToFilter,
                  invoices,
                });
              })
              .catch(err => {
                console.error("Error fetching invoices:", err);
                res.redirect("/error-404");
              });
          })
          .catch(err => {
            console.error("Error fetching branches:", err);
            res.redirect("/error-404");
          });
      } else {
        // Staff/admin: only their branch
        if (!user.branch) {
          return res.render("Invoice/paidInvoice", { user, branches: [], selectedBranchId: null, invoices: [] });
        }

        Invoice.find({ branch: user.branch._id, sales_type: "cash" })
          .populate("customer_id")
          .then(invoices => {
            res.render("Invoice/paidInvoice", {
              user,
              branches: [user.branch],
              selectedBranchId: user.branch._id,
              invoices,
            });
          })
          .catch(err => {
            console.error("Error fetching invoices:", err);
            res.redirect("/error-404");
          });
      }
    })
    .catch(err => {
      console.error("Error fetching user:", err);
      res.redirect("/error-404");
    });
});


router.get("/unpaidInvoice", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  const selectedBranchId = req.query.branchId;

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      if (user.role === 'owner') {
        Branch.find()
          .then(allBranches => {
            const branchToFilter = selectedBranchId || user.branch._id;

            Invoice.find({ branch: branchToFilter, sales_type: "credit" }) // filter credit invoices only
              .populate('customer_id')
              .then(invoices => {
                res.render("Invoice/unpaidInvoice", {
                  user,
                  ownerBranch: { branch: user.branch },
                  branches: allBranches,
                  selectedBranchId: branchToFilter,
                  invoices
                });
              })
              .catch(err => {
                console.error("Error fetching unpaid invoices:", err);
                res.redirect("/error-404");
              });
          })
          .catch(err => {
            console.error("Error fetching branches:", err);
            res.redirect("/error-404");
          });
      } else {
        // Staff/Admin see only their own branch's credit invoices
        Invoice.find({ branch: user.branch._id, sales_type: "credit" })
          .populate('customer_id')
          .then(invoices => {
            res.render("Invoice/unpaidInvoice", {
              user,
              ownerBranch: { branch: user.branch },
              branches: [user.branch],
              selectedBranchId: user.branch._id,
              invoices
            });
          })
          .catch(err => {
            console.error("Error fetching unpaid invoices:", err);
            res.redirect("/error-404");
          });
      }
    })
    .catch(err => {
      console.error("Error fetching user:", err);
      res.redirect("/error-404");
    });
});






router.get('/search-products', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);

  const branchId = req.user.branch; // Adjust based on where branch is stored

  if (!branchId) {
    return res.status(400).json({ error: 'Branch not specified' });
  }

  try {
    const products = await Product.find({
      branch: branchId,             // Filter by branch here
      product: { $regex: query, $options: "i" }
    }).limit(10);

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





// RECEIVED PRODUCT ROUTE LOGIC 
router.get("/addReceiveStock", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      if (user.role === 'owner') {
        Branch.findById(user.branch)
          .then(ownerBranch => {
            Branch.find()
              .then(allBranches => {
                Supplier.find()
                  .populate('supplierInvoice') // If this field exists
                  .then(suppliers => {
                    res.render("ReceivedStock/receiveStock", {
                      user,
                      ownerBranch: { branch: ownerBranch },
                      branches: allBranches,
                      suppliers
                    });
                  })
                  .catch(err => {
                    console.error("Error fetching suppliers:", err);
                    res.redirect("/error-404");
                  });
              });
          })
          .catch(err => {
            console.error(err);
            res.redirect('/error-404');
          });

      } else {
        Supplier.find()
          .populate('supplierInvoice') // If needed
          .then(suppliers => {
            res.render("ReceivedStock/receiveStock", {
              user,
              ownerBranch: { branch: user.branch },
              branches: [user.branch],
              suppliers
            });
          })
          .catch(err => {
            console.error("Error fetching suppliers:", err);
            res.redirect("/error-404");
          });
      }
    })
    .catch(err => {
      console.error(err);
      res.redirect("/error-404");
    });
});


router.get("/received-stock", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  const selectedBranchId = req.query.branchId;

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      if (user.role === 'owner') {
        Branch.find()
          .then(allBranches => {
            const branchToFilter = selectedBranchId || user.branch._id;

            ReceivedStock.find({ branch: branchToFilter })
              .populate('supplier branch')
              .then(stock => {
                res.render("ReceivedStock/received-stock", {
                  user,
                  ownerBranch: { branch: user.branch },
                  branches: allBranches,
                  selectedBranchId: branchToFilter,
                  stock
                });
              })
              .catch(err => {
                console.error("Error fetching received stock:", err);
                res.redirect("/error-404");
              });
          });
      } else {
        ReceivedStock.find({ branch: user.branch._id })
          .populate('supplier branch')
          .then(stock => {
            res.render("ReceivedStock/received-stock", {
              user,
              ownerBranch: { branch: user.branch },
              branches: [user.branch],
              selectedBranchId: user.branch._id,
              stock
            });
          })
          .catch(err => {
            console.error("Error fetching received stock:", err);
            res.redirect("/error-404");
          });
      }
    })
    .catch(err => {
      console.error(err);
      res.redirect("/error-404");
    });
});


router.post('/addReceiveStock', (req, res, next) => {
  const {
    invoice_number,
    supplier,
    payment_date,
    paid_amount,
    payment_status,
    item_name,
    product_id,
    unitCode,
    item_qty,
    item_rate
  } = req.body;

  const items = [];
  let grandTotal = 0;

  const wrapAsArray = (val) => (Array.isArray(val) ? val : [val]);

  const names = wrapAsArray(item_name);
  const ids = wrapAsArray(product_id);
  const units = wrapAsArray(unitCode);
  const qtys = wrapAsArray(item_qty);
  const rates = wrapAsArray(item_rate);

  const branch = req.user ? req.user.branch : null;

  if (!branch) {
    return res.status(400).send('Branch information is required.');
  }

  let currentIndex = 0;

  function processNextProduct() {
    if (currentIndex >= names.length) {
      return ReceivedStock.create({
        invoice_number,
        supplier,
        branch,
        payment_date,
        items,
        grand_total: grandTotal,
        paid_amount,
        due_amount: grandTotal - paid_amount,
        payment_status
      })
        .then(() => {
          res.redirect('/received-stock');
        })
        .catch(err => {
          next(err);
        });
    }

    const qtyNum = parseFloat(qtys[currentIndex]);
    const rateNum = parseFloat(rates[currentIndex]);
    const total = qtyNum * rateNum;
    grandTotal += total;

    items.push({
      product: ids[currentIndex],
      item_name: names[currentIndex],
      unitCode: units[currentIndex],
      item_qty: qtyNum,
      item_rate: rateNum,
      item_total: total
    });

    Product.findById(ids[currentIndex])
      .then(product => {
        if (!product || !product.variants || product.variants.length === 0) return;

        const variants = product.variants;
        const baseIndex = variants.findIndex(v => v.unitCode === units[currentIndex]);
        if (baseIndex === -1) return;

        // Update the quantity of the base unit
        variants[baseIndex].quantity += qtyNum;
        product.supplierPrice = rateNum;

        const baseQty = variants[baseIndex].quantity;

        // Recalculate other variant quantities
        for (let j = 0; j < variants.length; j++) {
          if (j === baseIndex) continue;
          const factor = variants[j].totalInBaseUnit;
          variants[j].quantity = baseQty * factor;
        }

        return product.save().then(saved => {
          // Create a single StockLedger entry per product
          const ledgerEntry = {
            date: new Date(payment_date),
            product: saved._id,
            variants: variants.map(variant => ({
              unitCode: variant.unitCode,
              stock_in: variant.unitCode === units[currentIndex] ? qtyNum : 0,
              stock_out: 0,
              balance: variant.quantity
            })),
            operator: req.user._id,
            branch
          };

          return StockLedger.create(ledgerEntry);
        });
      })
      .then(() => {
        currentIndex++;
        processNextProduct();
      })
      .catch(err => {
        console.error('Error updating product or ledger:', err);
        next(err);
      });
  }

  processNextProduct();
});










router.get("/deleteEachReceivedStock/:id", (req,res)=>{
  ReceivedStock.findByIdAndDelete(req.params.id)
  .then(user =>{
      res.redirect("/received-stock")
      console.log('stock successfully deleted');
      
  })
  .catch(err => console.log(err))
  console.log(req.params);
  
})

router.get("/viewReceivedStock/:id", (req, res) => {
   if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  ReceivedStock.findById(req.params.id)
                  .populate("supplier")
                  .populate("branch") 
                  .populate({
                    path: 'items.product', 
                    select: 'name unitCode' 
                  })
                  .then(receivedStock => {
                      if (!receivedStock) {
                        return res.redirect("/error-404");  // If the stock is not found
                      }
                        res.render("ReceivedStock/viewStock", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        receivedStock
                      });
                    })
                })
                .catch(err => {
                  console.error(err);
                  res.redirect('/error-404');
                });
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
          ReceivedStock.findById(req.params.id)
          .populate("supplier")
          .populate("branch") 
          .populate({
            path: 'items.product', 
            select: 'name unitCode' 
          })
          .then(receivedStock => {
              if (!receivedStock) {
                return res.redirect("/error-404");  // If the stock is not found
              }
                res.render("ReceivedStock/viewStock", {
                user: user,
                ownerBranch: { branch: ownerBranch },
                receivedStock
              });
            })
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});

router.get("/deleteEachReceivedStock/:id", (req, res) => {
  const receivedStockId = req.params.id;

  ReceivedStock.findById(receivedStockId)
    .then(stock => {
      if (!stock) {
        res.status(404).send("Received stock not found");
        return Promise.reject(); 
      }

      let index = 0;

      function processNextItem() {
        if (index >= stock.items.length) {
          // After all items processed, delete the stock
          return ReceivedStock.findByIdAndDelete(receivedStockId)
            .then(() => {
              console.log("Stock successfully deleted and inventory adjusted");
              res.redirect("/received-stock");
            })
            .catch(err => {
              console.error("Error deleting stock:", err);
              res.status(500).send("Server error");
            });
        }

        const item = stock.items[index];

        Product.findById(item.product)
          .then(product => {
            if (!product || !product.variants) {
              index++;
              processNextItem();
              return;
            }

            const variants = product.variants;
            const baseIndex = variants.findIndex(v => v.unitCode === item.unitCode);
            if (baseIndex === -1) {
              index++;
              processNextItem();
              return;
            }

            // Subtract quantity and reset supplier price
            variants[baseIndex].quantity -= item.item_qty;
            variants[baseIndex].supplierPrice = null;

            // Recalculate lower variant quantities
            let prevQty = variants[baseIndex].quantity;
            for (let j = baseIndex + 1; j < variants.length; j++) {
              prevQty = prevQty * variants[j].totalInBaseUnit;
              variants[j].quantity = prevQty;
            }

            return product.save()
              .then(() => {
                index++;
                processNextItem();
              });
          })
          .catch(err => {
            console.error("Error processing product:", err);
            res.status(500).send("Server error");
          });
      }

      processNextItem();
    })
    .catch(err => {
      if (err) {
        console.error("Error finding received stock:", err);
        res.status(500).send("Server error");
      }
    });
});




router.get("/deleteReceivedStock/:id", (req, res) => {
  const itemId = req.params.id;

  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        // Find the received stock that contains the item
        ReceivedStock.findOne(
          { "items._id": itemId },
          { "items.$": 1, branch: 1, invoice_number: 1 } // Include invoice_number and branch
        )
          .then(receivedDoc => {
            if (!receivedDoc || !receivedDoc.items || receivedDoc.items.length === 0) {
              return res.redirect("/error-404");
            }

            const matchedItem = receivedDoc.items[0];
            const branchId = receivedDoc.branch;
            const invoiceNumber = receivedDoc.invoice_number;

            // Add invoice number and parent document ID to item
            matchedItem.invoice_number = invoiceNumber;
            matchedItem.received_id = receivedDoc._id;

            // Populate the product manually
            Product.findById(matchedItem.product)
              .select("name unitCode")
              .then(product => {
                matchedItem.product = product;

                // Find the branch for context
                Branch.findById(branchId)
                  .then(ownerBranch => {
                    Branch.find()
                      .then(allBranches => {
                        res.render("ReceivedStock/viewEachStock", {
                          user: user,
                          ownerBranch: { branch: ownerBranch },
                          branches: allBranches,
                          item: matchedItem
                        });
                      })
                      .catch(err => {
                        console.error("Error finding all branches:", err);
                        res.redirect("/error-404");
                      });
                  })
                  .catch(err => {
                    console.error("Error finding branch:", err);
                    res.redirect("/error-404");
                  });
              })
              .catch(err => {
                console.error("Error finding product:", err);
                res.redirect("/error-404");
              });
          })
          .catch(err => {
            console.error("Error finding received stock item:", err);
            res.redirect("/error-404");
          });
      })
      .catch(err => {
        console.error("Error finding user:", err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});


router.get("/viewEachReceivedStock/:id", (req, res) => {
  const itemId = req.params.id;

  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        // Find the received stock that contains the item
        ReceivedStock.findOne(
          { "items._id": itemId },
          { "items.$": 1, branch: 1, invoice_number: 1 } // Include invoice_number and branch
        )
          .then(receivedDoc => {
            if (!receivedDoc || !receivedDoc.items || receivedDoc.items.length === 0) {
              return res.redirect("/error-404");
            }

            const matchedItem = receivedDoc.items[0];
            const branchId = receivedDoc.branch;
            const invoiceNumber = receivedDoc.invoice_number;

            // Add invoice number and parent document ID to item
            matchedItem.invoice_number = invoiceNumber;
            matchedItem.received_id = receivedDoc._id;

            // Populate the product manually
            Product.findById(matchedItem.product)
              .select("name unitCode")
              .then(product => {
                matchedItem.product = product;

                // Find the branch for context
                Branch.findById(branchId)
                  .then(ownerBranch => {
                    Branch.find()
                      .then(allBranches => {
                        res.render("ReceivedStock/viewEachStock", {
                          user: user,
                          ownerBranch: { branch: ownerBranch },
                          branches: allBranches,
                          item: matchedItem
                        });
                      })
                      .catch(err => {
                        console.error("Error finding all branches:", err);
                        res.redirect("/error-404");
                      });
                  })
                  .catch(err => {
                    console.error("Error finding branch:", err);
                    res.redirect("/error-404");
                  });
              })
              .catch(err => {
                console.error("Error finding product:", err);
                res.redirect("/error-404");
              });
          })
          .catch(err => {
            console.error("Error finding received stock item:", err);
            res.redirect("/error-404");
          });
      })
      .catch(err => {
        console.error("Error finding user:", err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});

router.post("/updateEachReceivedStock", (req, res) => {
  const {
    receivedStockId,
    item_name,
    unitCode,
    item_qty,
    item_rate,
    item_total,
  } = req.body;

  const itemId = req.query.itemId || req.body.itemId || req.body._id;

  if (!receivedStockId || !itemId) {
    return res.status(400).send("Invalid request: Missing IDs.");
  }

  ReceivedStock.findById(receivedStockId)
    .then(receivedDoc => {
      if (!receivedDoc) {
        return res.status(404).send("Received stock document not found.");
      }

      const item = receivedDoc.items.id(itemId);
      if (!item) {
        return res.status(404).send("Item not found in received stock.");
      }

      // Store original data
      const originalGrandTotal = receivedDoc.grand_total;
      const originalQty = item.item_qty;
      const originalRate = item.item_rate;

      // Parse input
      const newQty = parseFloat(item_qty);
      const newRate = parseFloat(item_rate);
      const newTotal = parseFloat(item_total);

      // Update item fields
      item.item_name = item_name;
      item.unitCode = unitCode;
      item.item_qty = newQty;
      item.item_rate = newRate;
      item.item_total = newTotal;

      // Recalculate grand total
      const newGrandTotal = receivedDoc.items.reduce((sum, i) => sum + (i.item_total || 0), 0);
      const diff = newGrandTotal - originalGrandTotal;

      receivedDoc.grand_total = newGrandTotal;

      // Handle due/refund
      if (diff !== 0) {
        receivedDoc.due_amount = (receivedDoc.due_amount || 0) + diff;
      }

      // Save ReceivedStock first
      return receivedDoc.save().then(() => {
        return Product.findById(item.product).then(product => {
          if (!product || !product.variants || product.variants.length === 0) return;

          const variants = product.variants;
          const variantIndex = variants.findIndex(v => v.unitCode === unitCode);
          if (variantIndex === -1) return;

          // Capture old supplierPrice from product level
          const oldVariant = {
            quantity: variants[variantIndex].quantity,
            supplierPrice: product.supplierPrice || 0
          };

          const qtyDiff = newQty - originalQty;
          variants[variantIndex].quantity += qtyDiff;

          // Update supplierPrice on product, NOT variant
          product.supplierPrice = newRate;

          let prevQty = variants[variantIndex].quantity;
          for (let j = variantIndex + 1; j < variants.length; j++) {
            prevQty = prevQty * variants[j].totalInBaseUnit;
            variants[j].quantity = prevQty;
          }

          return product.save().then(savedProduct => {
            // Create product change log
            const newVariant = {
              quantity: variants[variantIndex].quantity,
              supplierPrice: newRate
            };

            const log = new ProductChangeLog({
              productId: product._id,
              changedBy: req.user._id,
              changeType: "update",
              oldVariantData: oldVariant,
              newVariantData: newVariant,
              variantUnitCode: unitCode,
              balance: diff > 0 ? diff : 0,
              refund: diff < 0 ? Math.abs(diff) : 0,
              remarks: `Updated item in received stock invoice ${receivedDoc.invoice_number}`
            });

            return log.save();
          });
        });
      });
    })
    .then(() => {
      res.redirect("/received-stock");
    })
    .catch(err => {
      console.error("Error updating received stock item:", err);
      res.status(500).send("Server error");
    });
});




router.get("/productLogs", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  // === START LOGIC FOR LOGS ===
                  const { range } = req.query; // ?range=day/week/month
                  const now = new Date();
                  let startDate;

                  if (range === "day") {
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  } else if (range === "week") {
                    startDate = new Date();
                    startDate.setDate(startDate.getDate() - 7);
                  } else if (range === "month") {
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                  } else {
                    startDate = new Date(0); // If no range, get all
                  }

                  ProductChangeLog.find({
                    changeDate: { $gte: startDate, $lte: now }
                  })
                    .populate("productId changedBy")
                    .sort({ changeDate: -1 })
                    .then(logs => {
                      res.render("ReceivedStock/productLogs", {
                        user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        logs,
                        range: range || "all"
                      });
                    })
                    .catch(err => {
                      console.error("Error fetching product change logs:", err);
                      res.redirect("/error-404");
                    });
                  // === END LOGIC FOR LOGS ===
                })
                .catch(err => {
                  console.error("Error fetching branches:", err);
                  res.redirect('/error-404');
                });
            })
            .catch(err => {
              console.error("Error finding owner branch:", err);
              res.redirect('/error-404');
            });
        } else {
          res.redirect("/unauthorized");
        }
      })
      .catch(err => {
        console.error("Error finding user:", err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});

router.get("/viewLogs/:id", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  const logId = req.params.id;

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");
      if (user.role !== "owner") return res.redirect("/unauthorized");

      Branch.findById(user.branch)
        .then(ownerBranch => {
          Branch.find()
            .then(allBranches => {
              ProductChangeLog.findById(logId)
                .populate("productId changedBy")
                .then(log => {
                  if (!log) return res.redirect("/productLogs"); // fallback if log not found

                  res.render("ReceivedStock/viewLog", {
                    user,
                    ownerBranch: { branch: ownerBranch },
                    branches: allBranches,
                    log
                  });
                })
                .catch(err => {
                  console.error("Error fetching log:", err);
                  res.redirect("/error-404");
                });
            })
            .catch(err => {
              console.error("Error fetching branches:", err);
              res.redirect("/error-404");
            });
        })
        .catch(err => {
          console.error("Error finding owner branch:", err);
          res.redirect("/error-404");
        });
    })
    .catch(err => {
      console.error("Error finding user:", err);
      res.redirect("/error-404");
    });
});

router.get("/deleteProductLog/:id", (req, res) => {
  const logId = req.params.id;

  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  User.findById(req.user._id)
    .then(user => {
      if (!user) return res.redirect("/sign-in");
      if (user.role !== "owner") return res.redirect("/unauthorized");

      ProductChangeLog.findByIdAndDelete(logId)
        .then(() => {
          res.redirect("/productLogs");
        })
        .catch(err => {
          console.error("Error deleting log:", err);
          res.redirect("/error-404");
        });
    })
    .catch(err => {
      console.error("Error finding user:", err);
      res.redirect("/error-404");
    });
});








router.use(require("../route/query"))

// ENDS HERE 



// EXPENSES LOGIC 
router.get("/Expenses/addExpenses", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  res.render("Expenses/addExpenses", {
                    user: user,
                    ownerBranch: { branch: ownerBranch },
                    branches: allBranches
                  });
                })
                .catch(err => {
                  console.error(err);
                  res.redirect('/error-404');
                });
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
          res.render("Expenses/addExpenses", {
            user: user,
            ownerBranch: { branch: user.branch }
          });
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});

router.post("/addExpenses", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { title, amount, category, date, note } = req.body;

  User.findById(req.user._id)
    .then(user => {
      if (!user) throw new Error("User not found");

      const expense = new Expense({
        title,
        amount,
        category,
        date: date || new Date(),
        note,
        branch: user.branch, 
        created_by: user._id
      });

      return expense.save();
    })
    .then(savedExpense => {
      res.redirect("/Expenses/manageExpenses");
    })
    .catch(err => {
      console.error("Error saving expense:", err);
      res.status(500).json({ message: "Internal server error" });
    });
});


router.get("/Expenses/addExpensesInvoice", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  res.render("Expenses/addExpensesInvoice", {
                    user: user,
                    ownerBranch: { branch: ownerBranch },
                    branches: allBranches
                  });
                })
                .catch(err => {
                  console.error(err);
                  res.redirect('/error-404');
                });
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
          res.render("Expenses/addExpensesInvoice", {
            user: user,
            ownerBranch: { branch: user.branch }
          });
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});


router.get("/Expenses/manageExpenses", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  Expense.find()
                    .then(expenses => {
                      res.render("Expenses/manageExpenses", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        expenses
                      });
                    })
                    .catch(err => {
                      console.error("Error fetching categories:", err);
                      res.redirect("/error-404");
                    });
                })
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
         Expense.find()
         .then(expenses => {
          res.render("Expenses/manageExpenses", {
            user: user,
            ownerBranch: { branch: user.branch },
            expenses
          });
        })
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});

router.get("/Expenses/manageExpensesInvoice", (req, res) => {
  res.render("Expenses/manageExpensesInvoice", {});
});
router.get("/Expenses/paidExpenses", (req, res) => {
  res.render("Expenses/paidExpenses", {});
});
router.get("/Expenses/unpaidExpenses", (req, res) => {
  res.render("Expenses/unpaidExpenses", {});
});





















// LOAN LOGIC 
router.get("/addLoaner", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  res.render("loan/addLoaner", {
                    user: user,
                    ownerBranch: { branch: ownerBranch },
                    branches: allBranches
                  });
                })
                .catch(err => {
                  console.error(err);
                  res.redirect('/error-404');
                });
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
          res.render("loan/addLoaner", {
            user: user,
            ownerBranch: { branch: user.branch }
          });
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});

router.get("/manageLoaner", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  Loan.find()
                    .then(loaners => {
                      res.render("loan/manageLoaner", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        loaners
                      });
                    })
                    .catch(err => {
                      console.error("Error fetching categories:", err);
                      res.redirect("/error-404");
                    });
                })
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
         Loan.find()
         .then(loaners => {
          res.render("loan/manageLoaner", {
            user: user,
            ownerBranch: { branch: user.branch },
            loaners
          });
        })
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});

// VIEW AND DELETE LOANER 
router.get("/viewLoaner/:id", (req,res)=>{
  Loan.findById(req.params.id)
  .then(loaner =>{
      res.redirect("/manageLoaner")
      console.log('Loaner successfully found');
      
  })
  .catch(err => console.log(err))
  console.log(req.params);
  
})
router.get("/deleteLoaner/:id", (req,res)=>{
  Loan.findByIdAndDelete(req.params.id)
  .then(loaner =>{
      res.redirect("/manageLoaner")
      console.log('Loaner successfully deleted');
      
  })
  .catch(err => console.log(err))
  console.log(req.params);
  
})




// ADD LOAN 
router.get("/addLoan", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  Loan.find({}, 'loaner _id')
                    .then(loaners => {
                      res.render("loan/addLoan", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        loaners
                      });
                    })
                    .catch(err => {
                      console.error("Error fetching categories:", err);
                      res.redirect("/error-404");
                    });
                })
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
         Loan.find({}, 'loaner _id')
         .then(loaners => {
          res.render("loan/addLoan", {
            user: user,
            ownerBranch: { branch: user.branch },
            loaners
          });
        })
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});


router.get("/manageLoan", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  Loan.find()
                    .then(loans => {
                      res.render("loan/manageLoan", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        loans
                      });
                    })
                    .catch(err => {
                      console.error("Error fetching categories:", err);
                      res.redirect("/error-404");
                    });
                })
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
         Loan.find()
         .then(loans => {
          res.render("loan/manageLoan", {
            user: user,
            ownerBranch: { branch: user.branch },
            loans
          });
        })
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});

router.post("/deleteLoan/:id", (req, res) => {
  const loanId = req.params.id;

  Loan.findOneAndUpdate(
    { "loans._id": loanId },
    { $pull: { loans: { _id: loanId } } }
  )
    .then(() => {
      console.log("Loan successfully deleted");
      res.redirect("/manageLoan");
    })
    .catch(err => {
      console.error("Error deleting loan:", err);
      res.status(500).send("Error deleting loan");
    });
});


// LOAN POST 
router.post("/addLoaner", (req, res) => {
  const { loaner, mobile, address } = req.body;

  const newLoaner = new Loan({
    loaner,
    mobile,
    address,
    loans: []
  });

  newLoaner.save()
    .then(savedLoaner => {
      console.log(savedLoaner);
      
      res.redirect("/manageLoaner")
    })
    .catch(err => {
      console.error("Error adding loaner:", err);
      res.status(500).json({ message: "Server error" });
    });
});

router.post("/addLoan", (req, res) => {
  const { loanerId, loanAmount, loanContractDate, loanContractEndDate, details } = req.body;

  Loan.findById(loanerId)
    .then(loaner => {
      if (!loaner) return res.status(404).send("Loaner not found");

      loaner.loans.push({
        loanAmount,
        amount_to_repay: loanAmount,
        loanContractDate,
        loanContractEndDate,
        details
      });

      return loaner.save();
    })
    .then(() => {
      res.redirect("/manageLoan");
    })
    .catch(err => {
      console.error("Error adding loan:", err);
      res.status(500).send("Server error");
    });
});





// REPORT PAGE 
router.get("/Report/profit_loss", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  res.render("Report/profit_loss", {
                    user: user,
                    ownerBranch: { branch: ownerBranch },
                    branches: allBranches
                  });
                })
                .catch(err => {
                  console.error(err);
                  res.redirect('/error-404');
                });
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
          res.render("Report/profit_loss", {
            user: user,
            ownerBranch: { branch: user.branch }
          });
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});

router.get("/Report/salesLedger", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  res.render("Report/salesLedger", {
                    user: user,
                    ownerBranch: { branch: ownerBranch },
                    branches: allBranches
                  });
                })
                .catch(err => {
                  console.error(err);
                  res.redirect('/error-404');
                });
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
          res.render("Report/salesLedger", {
            user: user,
            ownerBranch: { branch: user.branch }
          });
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});

router.get("/purchase-report", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  res.render("Report/purchaseReport", {
                    user: user,
                    ownerBranch: { branch: ownerBranch },
                    branches: allBranches
                  });
                })
                .catch(err => {
                  console.error(err);
                  res.redirect('/error-404');
                });
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
          res.render("Report/purchaseReport", {
            user: user,
            ownerBranch: { branch: user.branch }
          });
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});

router.get("/stock-report", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/sign-in");
  }

  try {
    const user = await User.findById(req.user._id).populate("branch");
    if (!user) return res.redirect("/sign-in");

    const { productId, startDate, endDate } = req.query;
    const branchId = user.branch._id;

    const stockQuery = {
      branch: branchId,
    };

    if (productId) {
      stockQuery.product = productId;
    }

    if (startDate || endDate) {
      stockQuery.date = {};
      if (startDate) stockQuery.date.$gte = new Date(startDate);
      if (endDate) stockQuery.date.$lte = new Date(endDate);
    }

    const stockLedgers = await StockLedger.find(stockQuery)
      .populate("product")
      .populate("branch", "branch_name")
      .populate("operator", "fullname")
      .sort({ date: 1 });

    if (user.role === 'owner') {
      const ownerBranch = await Branch.findById(branchId);
      const allBranches = await Branch.find();

      return res.render("Report/stockreport", {
        user,
        ownerBranch: { branch: ownerBranch },
        branches: allBranches,
         stockLedgers: productId ? stockLedgers : undefined
      });
    }

    res.render("Report/stockreport", {
      user,
      ownerBranch: { branch: user.branch },
       stockLedgers: productId ? stockLedgers : undefined
    });

  } catch (err) {
    console.error(err);
    res.redirect("/error-404");
  }
});
router.get("/search-stockReport", async (req, res) => {
  const query = req.query.q;
  const branchId = req.user?.branch;

  if (!query || !branchId) return res.json([]);

  try {
    const regex = new RegExp(query, "i");

    const products = await Product.find({
      product: regex,
      branch: branchId,
    }).select("_id product").limit(10);

    res.json(products);
  } catch (err) {
    console.error("Product search failed:", err);
    res.status(500).json([]);
  }
});



router.get("/supplierInvoice-report", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/sign-in");
  }

  const { supplierId, startDate, endDate } = req.query;

  // Build query based on supplier and date filters
  const query = {};
  if (supplierId) query.supplier = supplierId;
  if (startDate && endDate) {
    query.date = {
      $gte: new Date(startDate),
      $lte: new Date(endDate + "T23:59:59"), // include whole end date
    };
  }

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      const userBranchId = user.branch?._id || user.branch;

      const renderView = (ownerBranch, branches = []) => {
        if (user.role !== 'owner') {
          // Limit query to user's branch if not owner
          query.branch = userBranchId;
        }

        if (Object.keys(query).length > 0) {
          SupplierLedger.find(query)
            .populate("supplier", "supplier")        // populate supplier name field
            .populate("branch", "branch_name")       // populate 
            .sort({ date: 1 })
            .then(entries => {
              // Debug log to verify data
              console.log("Supplier Ledger entries:", entries);

              res.render("Report/supplierReport", {
                user,
                ownerBranch: { branch: ownerBranch },
                branches,
                entries,
                startDate,
                endDate,
                supplierId,
              });
            })
            .catch(err => {
              console.error("Supplier Ledger Report Error:", err);
              res.render("Report/supplierReport", {
                user,
                ownerBranch: { branch: ownerBranch },
                branches,
                entries: [],
                startDate,
                endDate,
                supplierId,
                error: "Error retrieving ledger data",
              });
            });
        } else {
          // No filters, just render empty report
          res.render("Report/supplierReport", {
            user,
            ownerBranch: { branch: ownerBranch },
            branches,
            entries: [],
            startDate,
            endDate,
            supplierId,
          });
        }
      };

      if (user.role === 'owner') {
        Branch.findById(userBranchId)
          .then(ownerBranch => {
            Branch.find()
              .then(allBranches => renderView(ownerBranch, allBranches))
              .catch(err => {
                console.error(err);
                res.redirect("/error-404");
              });
          })
          .catch(err => {
            console.error(err);
            res.redirect("/error-404");
          });
      } else {
        renderView(user.branch);
      }
    })
    .catch(err => {
      console.error(err);
      res.redirect("/error-404");
    });
});


router.get('/api/suppliers/suggest', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);

  try {
    const suppliers = await Supplier.find({
      supplier: { $regex: q, $options: 'i' }  // Search in 'supplier' field
    })
      .limit(10)
      .select('_id supplier');  // Select _id and supplier (string)

    res.json(suppliers);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});


router.get("/debitor-report", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/sign-in");
  }

  const { customerId, startDate, endDate } = req.query;
  const query = customerId ? { customer: customerId } : null;

  if (startDate && endDate && query) {
    query.date = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      const renderView = (ownerBranch, branches = []) => {
        if (query) {
          CustomerLedger.find(query)
            .populate("customer", "customer_name")
            .populate("branch", "branch_name")
            .sort({ date: 1 })
            .then(entries => {
              res.render("Report/debitorReport", {
                user,
                ownerBranch: { branch: ownerBranch },
                branches,
                entries,
                startDate,
                endDate,
                customerId,
              });
            })
            .catch(err => {
              console.error("Ledger Report Error:", err);
              res.render("Report/debitorReport", {
                user,
                ownerBranch: { branch: ownerBranch },
                branches,
                entries: [],
                startDate,
                endDate,
                customerId,
                error: "Error retrieving ledger data",
              });
            });
        } else {
          res.render("Report/debitorReport", {
            user,
            ownerBranch: { branch: ownerBranch },
            branches,
            entries: [],
            startDate,
            endDate,
            customerId,
          });
        }
      };

      if (user.role === 'owner') {
        Branch.findById(user.branch)
          .then(ownerBranch => {
            Branch.find()
              .then(allBranches => renderView(ownerBranch, allBranches))
              .catch(err => {
                console.error(err);
                res.redirect("/error-404");
              });
          })
          .catch(err => {
            console.error(err);
            res.redirect("/error-404");
          });
      } else {
        renderView(user.branch);
      }
    })
    .catch(err => {
      console.error(err);
      res.redirect("/error-404");
    });
});


router.get("/stocktransfer-report", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  res.render("Report/stocktransfer", {
                    user: user,
                    ownerBranch: { branch: ownerBranch },
                    branches: allBranches
                  });
                })
                .catch(err => {
                  console.error(err);
                  res.redirect('/error-404');
                });
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
          res.render("Report/stocktransfer", {
            user: user,
            ownerBranch: { branch: user.branch }
          });
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});



router.get('/getProfitLossReport', (req, res) => {
  const { startDate, endDate } = req.query;
  console.log('Received query:', { startDate, endDate });

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  Invoice.find({
    payment_date: { $gte: start, $lte: end }
  })
  .then(invoices => {
    console.log(`Fetched ${invoices.length} invoices`);
    const report = {};

    invoices.forEach(invoice => {
      invoice.items.forEach(item => {
        const key = `${item.product}-${item.unitcode}`;
        if (!report[key]) {
          report[key] = {
            product_name: item.product_name,
            unitcode: item.unitcode,
            qty: 0,
            revenue: 0,
            cost: 0,
          };
        }
        report[key].qty += item.qty;
        report[key].revenue += item.total;
      });
    });

    const productIds = [...new Set(Object.keys(report).map(k => k.split('-')[0]))];
    console.log('Product IDs for cost fetch:', productIds);

    return Product.find({ _id: { $in: productIds } })
      .then(products => {
        console.log(`Fetched ${products.length} products`);
        products.forEach(product => {
          product.variants.forEach(variant => {
            const key = `${product._id}-${variant.unitCode}`;
            if (report[key]) {
              report[key].cost = variant.supplierPrice * report[key].qty;
            }
          });
        });

        const result = Object.values(report).map((r, i) => ({
          index: i + 1,
          product_name: r.product_name,
          unitcode: r.unitcode,
          qty: r.qty,
          revenue: r.revenue,
          cost: r.cost,
          profit: r.revenue - r.cost
        }));

        const totals = result.reduce((acc, curr) => {
          acc.revenue += curr.revenue;
          acc.cost += curr.cost;
          acc.profit += curr.profit;
          return acc;
        }, { revenue: 0, cost: 0, profit: 0 });

        // TODO: replace with real expense and debt queries
        const totalExpenses = 15000;
        const totalDebt = 15000;

        const netProfit = totals.profit - totalExpenses - totalDebt;

        res.json({
          data: result,
          totals: {
            revenue: totals.revenue,
            cost: totals.cost,
            grossProfit: totals.profit,
            totalExpenses,
            totalDebt,
            netProfit
          }
        });
      });
  })
  .catch(err => {
    console.error('Error in getProfitLossReport:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  });
});








// STAFF LOGIC 
router.get("/addStaffs", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  res.render("staffs/addStaffs", {
                    user: user,
                    ownerBranch: { branch: ownerBranch },
                    branches: allBranches
                  });
                })
                .catch(err => {
                  console.error(err);
                  res.redirect('/error-404');
                });
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
          res.render("staffs/addStaffs", {
            user: user,
            ownerBranch: { branch: user.branch }
          });
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});



router.get("/manageStaffs", (req, res, next) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  User.findById(req.user._id).populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      // Get staff and admin users
      User.find({ role: { $in: ["staff", "admin"] } })
        .populate("branch")
        .then(staffUsers => {
          // If user is owner, fetch all branches (for dropdown in header)
          if (user.role === "owner") {
            Branch.find()
              .then(branches => {
                res.render("staffs/manageStaffs", {
                  user,
                  staffUsers,
                  branches
                });
              })
              .catch(err => {
                console.error("Error loading branches:", err);
                next(err);
              });
          } else {
            // Admins/staff won't see all branches
            res.render("staffs/manageStaffs", {
              user,
              staffUsers,
              branches: []
            });
          }
        })
        .catch(err => {
          console.error("Error loading staff users:", err);
          next(err);
        });
    })
    .catch(err => {
      console.error("Error fetching logged-in user:", err);
      next(err);
    });
});

router.post('/updateStaff', (req, res, next) => {
  const { userId, fullname, username, role, branch } = req.body;

  User.findById(userId)
    .then(user => {
      if (!user) {
        const error = new Error('User not found');
        error.status = 404;
        return next(error);
      }

      user.fullname = fullname;
      user.username = username;
      user.role = role;
      user.branch = branch;

      return user.save();
    })
    .then(() => {
      res.redirect('/manageStaffs');
    })
    .catch(err => next(err));
});




router.post("/addStaffs", (req, res, next) => {
   console.log("Received body:", req.body); 
  const { fullname, username, password, role, branch } = req.body;

  if (!fullname || !username || !password || !branch || !role) {
  return res.render("staff/add", { error: "All fields are required." });
}


  User.findOne({ username })
    .then(existingUser => {
      if (existingUser) {
        return res.render("staff/add", { error: "Username already exists." });
      }

      bcrypt.hash(password, saltRounds)
        .then(hashedPassword => {
          const newUser = new User({
            fullname,
            username,
            password: hashedPassword,
            role: role.toLowerCase(), // "staff" or "admin"
            branch
          });

          newUser.save()
            .then(savedUser => {
              // Add the user to the branch's assignedUsers
              Branch.findByIdAndUpdate(
                branch,
                { $addToSet: { assignedUsers: savedUser._id } },
                { new: true }
              ).then(() => {
                res.redirect("/staffs?success=Staff added successfully");
              }).catch(err => {
                console.error("Error updating branch:", err);
                next(err);
              });
            })
            .catch(err => {
              console.error("Error saving staff user:", err);
              next(err);
            });
        })
        .catch(err => {
          console.error("Error hashing password:", err);
          next(err);
        });
    })
    .catch(err => {
      console.error("Error checking username:", err);
      next(err);
    });
});



// SETTING LOGIC 
router.get("/Settings/companyInfo", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                  res.render("Settings/companyInfo", {
                    user: user,
                    ownerBranch: { branch: ownerBranch },
                    branches: allBranches
                  });
                })
                .catch(err => {
                  console.error(err);
                  res.redirect('/error-404');
                });
            })
            .catch(err => {
              console.error(err);
              res.redirect('/error-404');
            });
        } else {
          res.render("Settings/companyInfo", {
            user: user,
            ownerBranch: { branch: user.branch }
          });
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect("/error-404");
      });
  } else {
    res.redirect("/sign-in");
  }
});


router.get("/Settings/signOut", (req, res) => {
  res.render("Settings/SignOut", {});
});




router.get('/logout', (req, res, next) => {
  const staffLogId = req.session.staffLogId;
  if (staffLogId) {
    StaffLog.findByIdAndUpdate(staffLogId, { signOutTime: new Date() })
      .catch(err => console.error('Error logging sign-out time:', err));
  }

  req.logout(err => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.redirect('/sign-in');
    });
  });
});

router.get('/staffLogs', function (req, res, next) {
  if (!req.user || req.user.role.toLowerCase() !== 'owner') {
    return res.status(403).send('Access denied');
  }

  const branchId = req.query.branch || null;

  let query = {};
  if (branchId && branchId !== '') {
    query.branch = branchId;
  }

  StaffLog.find(query)
    .populate('user', 'fullname username role')
    .sort({ signInTime: -1 })
    .exec()
    .then(logs => {
      return Branch.find({}).exec()
        .then(branches => {
          res.render('staffs/staffLogs', {
            user: req.user,
            logs: logs,
            branches: branches,
            selectedBranch: branchId,
          });
        });
    })
    .catch(err => next(err));
});


// PARKING STORE 

router.get("/AddparkingStore", (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/sign-in");
  }

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");
      if (user.role !== 'owner') {
        return res.redirect("/unauthorized");
      }

      Branch.findById(user.branch)
        .then(ownerBranch => {
          Branch.find()
            .then(allBranches => {
              res.render("ParkingStore/addParkingStore", {
                user: user,
                ownerBranch: { branch: ownerBranch },
                branches: allBranches
              });
            })
            .catch(err => {
              next(err);
            });
        })
        .catch(err => {
          next(err);
        });
    })
    .catch(err => {
      next(err);
    });
});

router.post("/create-parking-store", (req, res) => {
  const { storeName } = req.body;
  const branch = req.user?.branch;
  const userId = req.user?._id;

  if (!storeName || !branch) {
    return res.status(400).json({ error: "Store name and branch are required" });
  }

  // Check for existing store name in this branch
  ParkingStore.findOne({ storeName, branch })
    .then(existing => {
      if (existing) {
        return res.status(409).json({ error: "Parking store name already exists for this branch" });
      }

      return ParkingStore.create({
        storeName,
        branch,
        createdBy: userId
      });
    })
    .then(newStore => {
      if (newStore) {
        res.status(201).json({
          message: "Parking store created successfully",
          parkingStore: newStore
        });
      }
    })
    .catch(err => {
      console.error("Error creating parking store:", err);
      res.status(500).json({ error: "Internal server error" });
    });
});

router.get("/manageParkingStore", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      if (user.role === 'owner') {
        Branch.findById(user.branch)
          .then(ownerBranch => {
            Branch.find()
              .then(allBranches => {
                ParkingStore.find({ branch: user.branch })
                  .populate('branch', 'branch_name') // Populate branch name
                  .then(parkingStores => {
                    res.render("ParkingStore/manageParkingStore", {
                      user,
                      ownerBranch: { branch: ownerBranch },
                      branches: allBranches,
                      parkingStores
                    });
                  })
                  .catch(err => {
                    console.error("Error fetching parking stores:", err);
                    res.redirect("/error-404");
                  });
              })
              .catch(err => {
                console.error(err);
                res.redirect('/error-404');
              });
          })
          .catch(err => {
            console.error(err);
            res.redirect('/error-404');
          });
      } else {
        ParkingStore.find({ branch: user.branch })
          .then(parkingStores => {
            res.render("ParkingStore/manageParkingStore", {
              user,
              ownerBranch: { branch: user.branch },
              parkingStores
            });
          })
          .catch(err => {
            console.error("Error fetching parking stores:", err);
            res.redirect("/error-404");
          });
      }
    })
    .catch(err => {
      console.error(err);
      res.redirect("/error-404");
    });
});

router.get("/parkStock", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  const selectedBranchId = req.query.branchId;

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      const branchToFilter = user.role === "owner" && selectedBranchId
        ? selectedBranchId
        : user.branch._id;

      // Fetch products of the selected branch
      Product.find({ branch: branchToFilter })
        .populate('variants.supplier')
        .populate('branch')
        .then(products => {
          // Fetch parking stores for that branch only
          ParkingStore.find({ branch: branchToFilter })
            .then(parkingStores => {
              res.render("ParkingStore/parkStock", {
                user,
                ownerBranch: { branch: user.branch },
                branches: user.role === 'owner' ? [user.branch] : null,
                selectedBranchId: branchToFilter,
                products,
                parkingStores
              });
            })
            .catch(err => {
              console.error("Error fetching parking stores:", err);
              res.status(500).send("Error fetching parking stores.");
            });
        })
        .catch(productErr => {
          console.error(productErr);
          res.status(500).send("Error fetching products.");
        });
    })
    .catch(err => {
      console.error(err);
      res.status(500).send("Error finding user.");
    });
});

router.post("/addParkingStock", async (req, res) => {
  console.log("Received request to add parking stock:", req.body);

  const {
    branch,
    parkingStoreId,
    productId,
    unitCode,
    quantity
  } = req.body;

  const productIds = Array.isArray(productId) ? productId : [productId];
  const unitCodes = Array.isArray(unitCode) ? unitCode : [unitCode];
  const quantities = Array.isArray(quantity) ? quantity : [quantity];

  try {
    for (let i = 0; i < productIds.length; i++) {
      const prodId = productIds[i];
      const baseUnit = unitCodes[i];
      const moveQty = parseFloat(quantities[i]);

      const productDoc = await Product.findById(prodId);
      if (!productDoc) throw new Error("Product not found");

      const baseVariant = productDoc.variants.find(v => v.unitCode === baseUnit);
      if (!baseVariant) throw new Error(`Variant ${baseUnit} not found`);

      const baseUnitRatio = baseVariant.totalInBaseUnit || 1;
      const totalInBase = moveQty * baseUnitRatio;

      // Deduct from all variants
      productDoc.variants = productDoc.variants.map(v => {
        const multiplier = v.totalInBaseUnit || 1;
        const deductQty = moveQty * multiplier;
        return {
          ...v,
          quantity: Math.max(0, v.quantity - deductQty)
        };
      });

      await productDoc.save();

      // Add to parking stock
      const existingParking = await ParkingStock.findOne({
        parkingStore: parkingStoreId,
        product: prodId,
        unitCode: baseUnit,
      });

      if (existingParking) {
        existingParking.quantity += moveQty;
        existingParking.totalInBaseUnit += totalInBase;
        await existingParking.save();
      } else {
        await ParkingStock.create({
          parkingStore: parkingStoreId,
          branch: branch,
          product: prodId,
          unitCode: baseUnit,
          quantity: moveQty,
          totalInBaseUnit: totalInBase
        });
      }

      // ✅ Create StockLedger entry for this product
      const ledgerEntry = {
        date: new Date(),
        product: productDoc._id,
        variants: productDoc.variants.map(v => ({
          unitCode: v.unitCode,
          stock_in: 0,
          stock_out: v.unitCode === baseUnit ? moveQty : 0,
          balance: v.quantity
        })),
        operator: req.user?._id || null,
        branch: branch,
        remark: `Moved ${moveQty} ${baseUnit} to parking store`
      };

      await StockLedger.create(ledgerEntry);
    }

    res.redirect("/parkingStock");
  } catch (err) {
    console.error("Error:", err);
    res.status(500).send(err.message || "Server Error");
  }
});



router.post('/moveOutParkingStock', async (req, res) => {
  console.log("Received request to move out parking stock:", req.body);

  const {
    branch,
    parkingStoreId,
    productId,
    unitCode,
    quantity,
    movedAt = new Date()
  } = req.body;

  const productIds = Array.isArray(productId) ? productId : [productId];
  const unitCodes = Array.isArray(unitCode) ? unitCode : [unitCode];
  const quantities = Array.isArray(quantity) ? quantity : [quantity];

  try {
    for (let i = 0; i < productIds.length; i++) {
      const prodId = productIds[i];
      const moveQty = parseFloat(quantities[i]);
      const unit = unitCodes[i];

      const product = await Product.findById(prodId);
      if (!product) throw new Error('Product not found');

      const targetVariant = product.variants.find(v => v.unitCode === unit);
      if (!targetVariant) throw new Error(`Variant ${unit} not found`);

      const unitFactor = targetVariant.totalInBaseUnit || 1;
      const moveQtyInBase = moveQty * unitFactor;

      // 1. Deduct from Parking Stock
      const parkingStock = await ParkingStock.findOne({
        parkingStore: parkingStoreId,
        branch,
        product: prodId,
        unitCode: unit
      });

      if (!parkingStock) throw new Error(`Parking stock for ${unit} not found`);
      if (parkingStock.quantity < moveQty) throw new Error(`Not enough stock in parking store`);

      parkingStock.quantity -= moveQty;
      parkingStock.totalInBaseUnit -= moveQtyInBase;
      await parkingStock.save();

      // 2. Add to Product Stock (recalculate all variants)
      const baseIndex = product.variants.findIndex(v => v.unitCode === unit);
      if (baseIndex === -1) throw new Error(`Base variant not found`);

      product.variants[baseIndex].quantity += moveQty;

      const updatedBaseQty = product.variants[baseIndex].quantity;
      for (let j = 0; j < product.variants.length; j++) {
        if (j === baseIndex) continue;
        const factor = product.variants[j].totalInBaseUnit || 1;
        product.variants[j].quantity = updatedBaseQty * factor;
      }

      await product.save();

      // 3. Log to StockLedger
      await StockLedger.create({
        date: new Date(movedAt),
        product: prodId,
        variants: product.variants.map(v => ({
          unitCode: v.unitCode,
          stock_in: v.unitCode === unit ? moveQty : 0,
          stock_out: 0,
          balance: v.quantity
        })),
        operator: req.user?._id || null,
        branch
      });
    }

    res.redirect('/parkingStock'); // or res.json({ success: true })
  } catch (err) {
    console.error("Move out error:", err);
    res.status(500).send(err.message || "Error moving out parking stock");
  }
});


router.get("/viewStore/:id", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  try {
    const user = await User.findById(req.user._id).populate("branch");
    if (!user) return res.redirect("/sign-in");

    const store = await ParkingStore.findById(req.params.id);
    if (!store) return res.redirect("/error-404");

    const stock = await ParkingStock.find({ parkingStore: req.params.id })
       .populate({
          path: "product",
          select: "product"
        })
        .populate({
          path: "branch",
          select: "branch_name"
        })
        .populate({
          path: "parkingStore",
          select: "storeName"
        });
      console.log("Here's the parking stock:" + stock);
      
    res.render("ParkingStore/viewStore", {
      user,
      ownerBranch: { branch: user.branch },
      store,
      stock
    });
  } catch (err) {
    console.error("Error in viewStore:", err);
    res.redirect("/error-404");
  }

  console.log("Params:", req.params); // Optional for debugging
});

router.post('/adjustParkingStock', async (req, res) => {
  console.log("Adjust parking stock payload:", req.body);

  const {
    parkingStockID,
    unitCode,
    adjustedQuantity,
    adjustmentReason
  } = req.body;

  try {
    const newQty = parseFloat(adjustedQuantity);

    const parkingStock = await ParkingStock.findById(parkingStockID);
    if (!parkingStock) throw new Error('Parking stock not found');

    const product = await Product.findById(parkingStock.product);
    if (!product) throw new Error('Product not found');

    const variant = product.variants.find(v => v.unitCode === unitCode);
    if (!variant) throw new Error(`Variant ${unitCode} not found`);

    const unitFactor = variant.totalInBaseUnit || 1;

    const prevQty = parkingStock.quantity;
    const delta = newQty - prevQty;
    const deltaInBase = delta * unitFactor;

    // 1. Update ParkingStock
    parkingStock.quantity = newQty;
    parkingStock.totalInBaseUnit = newQty * unitFactor;
    await parkingStock.save();

    // 2. Update Product Base Variant & Recalculate All
    const baseIndex = product.variants.findIndex(v => v.unitCode === unitCode);
    if (baseIndex === -1) throw new Error(`Base variant not found`);

    product.variants[baseIndex].quantity += delta;

    const updatedBaseQty = product.variants[baseIndex].quantity;
    for (let i = 0; i < product.variants.length; i++) {
      if (i === baseIndex) continue;
      const factor = product.variants[i].totalInBaseUnit || 1;
      product.variants[i].quantity = updatedBaseQty * factor;
    }

    await product.save();

    // 3. Log to StockLedger
    await StockLedger.create({
      date: new Date(),
      product: parkingStock.product,
      variants: product.variants.map(v => ({
        unitCode: v.unitCode,
        stock_in: delta > 0 && v.unitCode === unitCode ? Math.abs(delta) : 0,
        stock_out: delta < 0 && v.unitCode === unitCode ? Math.abs(delta) : 0,
        balance: v.quantity
      })),
      operator: req.user?._id || null,
      branch: parkingStock.branch,
      reason: adjustmentReason || 'Stock Adjustment'
    });

    res.redirect('/parkingStock'); // or res.json({ success: true })
  } catch (err) {
    console.error("Error adjusting stock:", err);
    res.status(500).send(err.message || 'Failed to adjust stock');
  }
});

// PARKING STORE ENDS HERE 






// USER SIGN-UP LOGIC 
router.get("/", (req, res) => {
  res.render("Auth/login");
});


router.get("/sign-in", (req,res)=>{
  res.render("Auth/login")
})
router.get("/register", (req,res)=>{
  res.render("Auth/register")
})




router.post("/register", (req, res, next) => {
  const { fullname, username, password, role, branch_name, branch_address, branch_phone } = req.body;

  User.findOne({ username: username })
    .then(existingUser => {
      if (existingUser) {
        return res.render("Auth/auth-login", {
          error: "Username already exists. Please login.",
          existingUser
        });
      }

      bcrypt.hash(password, saltRounds)
        .then(hashedPassword => {
          const newUser = new User({
            fullname,
            username,
            password: hashedPassword,
            role: role || 'staff'
          });

          newUser.save()
            .then(savedUser => {
              if (role === 'owner') {
                Branch.findOne({ isHeadOffice: true })
                  .then(existingHeadOffice => {
                    const isHeadOffice = !existingHeadOffice;

                    const newBranch = new Branch({
                      branch_name,
                      branch_address,
                      branch_phone,
                      createdBy: savedUser._id,
                      isHeadOffice,
                      assignedUsers: [savedUser._id]
                    });

                    newBranch.save()
                      .then(savedBranch => {
                        savedUser.branch = savedBranch._id;
                        savedUser.save()
                          .then(() => res.redirect("/sign-in"))
                          .catch(err => {
                            console.error("Error saving user with branch ref:", err);
                            next(err);
                          });
                      })
                      .catch(err => {
                        console.error("Error creating branch:", err);
                        next(err);
                      });
                  })
                  .catch(err => {
                    console.error("Error checking head office:", err);
                    next(err);
                  });
              } else {
                const newBranch = new Branch({
                  branch_name,
                  branch_address,
                  branch_phone,
                  createdBy: savedUser._id,
                  assignedUsers: [savedUser._id]
                });

                newBranch.save()
                  .then(savedBranch => {
                    savedUser.branch = savedBranch._id;
                    savedUser.save()
                      .then(() => res.redirect("/sign-in"))
                      .catch(err => {
                        console.error("Error saving user with branch ref:", err);
                        next(err);
                      });
                  })
                  .catch(err => {
                    console.error("Error creating branch:", err);
                    next(err);
                  });
              }
            })
            .catch(err => {
              console.error("Error saving user:", err);
              next(err);
            });
        })
        .catch(err => {
          console.error("Error hashing password:", err);
          next(err);
        });
    })
    .catch(err => {
      console.error("Error checking existing user:", err);
      next(err);
    });
});



const checkAndCreateNotifications = require('../Utils/checkAndCreateNotifications'); // ✅ Import

router.post("/sign-in", function (req, res, next) {
  passport.authenticate("local", function (err, user, info) {
    if (err) return next(err);

    if (!user) {
      if (info.message === "User not found") {
        return res.redirect("/register");
      } else if (info.message === "Incorrect password") {
        return res.redirect("/sign-in?error=Incorrect%20password");
      } else {
        return res.redirect("/sign-in?error=Authentication%20failed");
      }
    }

    req.logIn(user, async function (err) {
      if (err) return next(err);

      try {
        // ✅ Generate notifications for the logged-in user
        const populatedUser = await User.findById(user._id).populate("branch");
        await checkAndCreateNotifications(populatedUser);

        // ✅ Log staff activity
        const log = await StaffLog.create({
          user: user._id,
          role: user.role,
          signInTime: new Date()
        });

        req.session.staffLogId = log._id;
        return res.redirect("/dashboard");
      } catch (err) {
        console.error("Login flow error:", err);
        return res.redirect("/dashboard"); // still proceed
      }
    });
  })(req, res, next);
});




passport.use(new LocalStrategy(function verify(username, password, done) {
    User.findOne({ username: username }).then(function (foundUser) {
        if (!foundUser) {
            return done(null, false, { message: "User not found" });
        }

        bcrypt.compare(password, foundUser.password, function (err, result) {
            if (err) return done(err);
            if (result) {
                return done(null, foundUser);
            } else {
                return done(null, false, { message: "Incorrect password" });
            }
        });
    }).catch(err => done(err));
}));

passport.serializeUser((user, done) =>{
    done(null, user);
})

passport.deserializeUser((user, done) =>{
    done(null, user);
})


module.exports = router;
