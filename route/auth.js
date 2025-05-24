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




router.get("/dashboard", (req, res) => {
  if (!req.user) return res.redirect("/sign-in");

  const range = req.query.range || 'daily';
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

  function getTotalsForBranch(branchId) {
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
                    Customer.find()
                      .then(customers => {
                        getTotalsForBranch(ownerBranch._id)
                          .then(results => {
                            let totalCashSalesAmount = 0;
                            let totalCreditSales = 0;
                            let totalDebtorsPayment = 0;

                            results.forEach(r => {
                              if (r._id === 'cash') {
                                totalCashSalesAmount = r.totalAmount;
                              } else if (r._id === 'credit') {
                                totalCreditSales = r.totalAmount;
                                totalDebtorsPayment = r.totalRemainingAmount;
                              }
                            });

                            const totalSales = totalCashSalesAmount + totalCreditSales;

                            // Top 5 Customers with customer_name
                            Invoice.aggregate([
                              { $match: { branch: ownerBranch._id, createdAt: { $gte: startDate, $lte: endDate } } },
                              {
                                $group: {
                                  _id: "$customer_id",       // Group by customer_id
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
                                  customer_name: "$customer.customer_name" // Use customer_name here
                                }
                              },
                              { $sort: { totalSpent: -1 } },
                              { $limit: 5 }
                            ])
                            .then(topCustomers => {
                              // Top 5 Selling Products
                              Invoice.aggregate([
                                { $match: { branch: ownerBranch._id, createdAt: { $gte: startDate, $lte: endDate } } },
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
                              ])
                              .then(topSellingProducts => {
                                // Low Performing Products
                                Invoice.aggregate([
                                  { $match: { branch: ownerBranch._id, createdAt: { $gte: startDate, $lte: endDate } } },
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
                                ])
                                .then(lowPerformingProducts => {
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
                                    }
                                  });
                                })
                                .catch(err => {
                                  console.error("Low performing product error:", err);
                                  res.redirect('/error-404');
                                });
                              })
                              .catch(err => {
                                console.error("Top selling product error:", err);
                                res.redirect('/error-404');
                              });
                            })
                            .catch(err => {
                              console.error("Top customers error:", err);
                              res.redirect('/error-404');
                            });
                          })
                          .catch(err => {
                            console.error("Error fetching totals:", err);
                            res.redirect('/error-404');
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
        // Staff dashboard fallback
        res.render("index", {
          user,
          ownerBranch: { branch: user.branch },
          branches: [],
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
          }
        });
      }
    })
    .catch(err => {
      console.error(err);
      res.redirect('/error-404');
    });
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
        invoice_type,
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
          );
        })
        .then(updatedBranch => {
          console.log('Branch updated with supplier invoice ID:', updatedBranch);
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
  const { query, branchId } = req.query;

  if (!query || !branchId) {
      return res.status(400).json({ error: 'Missing query or branchId' });
  }

  try {
      // Find the branch and populate its stock (assuming stock is an array or ref)
      const branch = await Branch.findById(branchId).populate({
          path: 'stock',
          match: { product: new RegExp(query, 'i') }
      });

      if (!branch || !branch.stock) {
          return res.json({ product: null });
      }

      // If stock is an array, find the first matching product
      const matchedProduct = Array.isArray(branch.stock)
          ? branch.stock.find(p => p.product.toLowerCase().includes(query.toLowerCase()))
          : branch.stock;

      res.json({ product: matchedProduct });
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});




router.post('/stockTransfer', (req, res) => {
  const { from_branch, to_branch, productId, unitCode, quantity, note } = req.body;

  // Normalize to arrays
  const unitCodes = Array.isArray(unitCode) ? unitCode : [unitCode];
  const quantities = Array.isArray(quantity) ? quantity : [quantity];

  Product.findById(productId)
    .then(sourceProduct => {
      if (!sourceProduct) {
        return res.status(404).send("Source product not found.");
      }

      Product.findOne({ product: sourceProduct.product, branch: to_branch })
        .then(destProduct => {
          if (destProduct) {
            // Product exists in destination branch — update variants
            unitCodes.forEach((code, i) => {
              const qty = parseInt(quantities[i]);
              const existingVariant = destProduct.variants.find(v => v.unitCode === code);
              if (existingVariant) {
                existingVariant.quantity += qty;
              } else {
                const sourceVariant = sourceProduct.variants.find(v => v.unitCode === code);
                if (sourceVariant) {
                  destProduct.variants.push({
                    unitCode: code,
                    quantity: qty,
                    lowStockAlert: sourceVariant.lowStockAlert,
                    supplierPrice: sourceVariant.supplierPrice,
                    sellPrice: sourceVariant.sellPrice,
                    supplier: sourceVariant.supplier
                  });
                }
              }
            });

            destProduct.save()
              .then(updated => {
                updateSourceProduct();
              })
              .catch(err => {
                console.error("Error updating destination product:", err);
                res.status(500).send("Failed to update destination product.");
              });

          } else {
            // Product does not exist in destination — create it
            const selectedVariants = [];

            unitCodes.forEach((code, i) => {
              const qty = parseInt(quantities[i]);
              const sourceVariant = sourceProduct.variants.find(v => v.unitCode === code);
              if (sourceVariant) {
                selectedVariants.push({
                  unitCode: code,
                  quantity: qty,
                  lowStockAlert: sourceVariant.lowStockAlert,
                  supplierPrice: sourceVariant.supplierPrice,
                  sellPrice: sourceVariant.sellPrice,
                  supplier: sourceVariant.supplier
                });
              }
            });

            const newProduct = new Product({
              product: sourceProduct.product,
              category: sourceProduct.category,
              branch: to_branch,
              product_detail: sourceProduct.product_detail,
              mfgDate: sourceProduct.mfgDate,
              expDate: sourceProduct.expDate,
              product_image: sourceProduct.product_image,
              variants: selectedVariants
            });

            newProduct.save()
              .then(savedProduct => {
                Branch.findByIdAndUpdate(to_branch, { $push: { stock: savedProduct._id } })
                  .then(() => {
                    updateSourceProduct();
                  })
                  .catch(err => {
                    console.error("Failed to update destination branch stock:", err);
                    res.status(500).send("Destination branch update failed.");
                  });
              })
              .catch(err => {
                console.error("Failed to create new product in destination:", err);
                res.status(500).send("Destination product creation failed.");
              });
          }

          // Function to deduct from source product and log the transfer
          function updateSourceProduct() {
            unitCodes.forEach((code, i) => {
              const qty = parseInt(quantities[i]);
              const sourceVariant = sourceProduct.variants.find(v => v.unitCode === code);
              if (sourceVariant) {
                sourceVariant.quantity -= qty;
              }
            });

            sourceProduct.save()
              .then(() => {
                // ✅ Build transfer stock array
                const transferStockItems = [];

                for (let i = 0; i < unitCodes.length; i++) {
                  const code = unitCodes[i];
                  const qty = parseInt(quantities[i]);
                  const variant = sourceProduct.variants.find(v => v.unitCode === code);

                  transferStockItems.push({
                    productId: productId,
                    product: sourceProduct.product,
                    unitCode: code,
                    quantity: qty,
                    supplierPrice: variant?.supplierPrice || 0,
                    sellPrice: variant?.sellPrice || 0,
                    worth: qty * (variant?.supplierPrice || 0),
                    mfgDate: sourceProduct.mfgDate,
                    expDate: sourceProduct.expDate
                  });
                }

                // ✅ Save transfer record
                const transferRecord = new TransferStock({
                  transaction_number: `TX-${Date.now()}`,
                  from_branch,
                  to_branch,
                  transfer_date: new Date(),
                  note: note || '',
                  stock: transferStockItems
                });

                transferRecord.save()
                  .then(() => {
                    res.redirect('/stockTransfer');
                  })
                  .catch(err => {
                    console.error("Error saving transfer record:", err);
                    res.status(500).send("Transfer log save failed.");
                  });

              })
              .catch(err => {
                console.error("Failed to update source product quantities:", err);
                res.status(500).send("Source product update failed.");
              });
          }

        })
        .catch(err => {
          console.error("Error checking destination product:", err);
          res.status(500).send("Internal error checking destination.");
        });
    })
    .catch(err => {
      console.error("Error finding source product:", err);
      res.status(500).send("Failed to retrieve source product.");
    });
});













// EXPIRED PRODUCT LOGIC 
router.get("/expiredProducts", (req, res) => {
    const currentDate = new Date();

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
                    Product.find({ expDate: { $lt: currentDate } })
                      .then(expiredProducts => {
                        res.render("ExpiredProducts/expiredProducts", {
                          user: user,
                          ownerBranch: { branch: ownerBranch },
                          branches: allBranches,
                          expiredProducts
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
           Product.find({ expDate: { $lt: currentDate } })
           .then(expiredProducts => {
            res.render("ExpiredProducts/expiredProducts", {
              user: user,
              ownerBranch: { branch: user.branch },
              expiredProducts
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

// DEAD PRODUCT LOGIC 
router.get("/DeadStockProducts", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        const currentDate = new Date();
        const cutoffDate = new Date(currentDate.setMonth(currentDate.getMonth() - 1));
        
        if (user.role === 'owner') {
          Branch.findById(user.branch)
            .then(ownerBranch => {
              Branch.find()
                .then(allBranches => {
                     Product.find({created_at: { $lt: cutoffDate },"variants.quantity": { $gt: 0 }})
                    .then(deadStockProducts  => {
                      res.render("DeadStockProducts/deadStockProducts", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        deadStockProducts 
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
          Product.find({created_at: { $lt: cutoffDate },"variants.quantity": { $gt: 0 }})
         .then(deadStockProducts => {
          res.render("DeadStockProducts/deadStockProducts", {
            user: user,
            ownerBranch: { branch: user.branch },
            deadStockProducts
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
                  Customer.find()
                    .then(customers => {
                      res.render("Customers/manageCustomers", {
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        customers
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
         Customer.find()
         .then(customers => {
          res.render("Customers/manageCustomers", {
            user: user,
            ownerBranch: { branch: user.branch },
            customers
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
        branch: user.branch  // save branch to customer
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


router.get("/creditCustomers", (req, res, next) => {
  if (!req.isAuthenticated()) return res.redirect("/sign-in");

  User.findById(req.user._id)
    .populate("branch")
    .then(user => {
      if (!user) return res.redirect("/sign-in");

      const filterCreditCustomers = (customers) => {
        return customers.filter(customer =>
          customer.sales_type === 'credit' &&
          Array.isArray(customer.transactions) &&
          customer.transactions.some(t => t.remaining_amount > 0)
        );
      };

      if (user.role === "owner") {
        Branch.findById(user.branch)
          .then(ownerBranch => {
            Branch.find()
              .then(allBranches => {
                Customer.find()
                  .then(customers => {
                    const creditCustomers = filterCreditCustomers(customers);
                    res.render("Customers/creditCustomers", {
                      user: user,
                      ownerBranch: { branch: ownerBranch },
                      branches: allBranches,
                      customers: creditCustomers
                    });
                  })
                  .catch(next);
              })
              .catch(next);
          })
          .catch(next);
      } else {
        Customer.find({ branch: user.branch._id })
          .then(customers => {
            const creditCustomers = filterCreditCustomers(customers);
            res.render("Customers/creditCustomers", {
              user: user,
              ownerBranch: { branch: user.branch },
              customers: creditCustomers
            });
          })
          .catch(next);
      }
    })
    .catch(next);
});




router.get("/paidCustomers", (req, res, next) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id)
      .populate("branch")
      .then(user => {
        if (!user) return res.redirect("/sign-in");

        const isOwner = user.role === 'owner';

        const loadBranches = isOwner
          ? Branch.find().then(branches => ({ allBranches: branches }))
          : Promise.resolve({});

        const loadBranchDetails = isOwner
          ? Branch.findById(user.branch).then(ownerBranch => ({ ownerBranch }))
          : Promise.resolve({ ownerBranch: { branch: user.branch } });

        Promise.all([loadBranchDetails, loadBranches])
          .then(([branchData, allBranchesData]) => {
            return Customer.find().then(customers => {
              const paidCustomers = customers.filter(customer =>
                customer.sales_type === 'cash' &&
                customer.transactions.length > 0 &&
                customer.transactions.every(transaction => transaction.remaining_amount <= 0)
              );

              res.render("Customers/paidCustomers", {
                user: user,
                ownerBranch: branchData.ownerBranch,
                branches: allBranchesData.allBranches || [],
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
  } else {
    res.redirect("/sign-in");
  }
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
  if (!req.isAuthenticated()) {
    return res.redirect("/sign-in");
  }

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
                CashReceivable.find()
                  .populate('userId') // Uses refPath automatically
                  .then(transactions => {
                    res.render("Transaction/transactionHistory", {
                      user,
                      ownerBranch: { branch: ownerBranch },
                      branches: allBranches,
                      transactions
                    });
                  })
                  .catch(err => next(err));
              })
              .catch(err => next(err));
          })
          .catch(err => next(err));
      } else {
        CashReceivable.find()
          .populate('userId')
          .then(transactions => {
            res.render("Transaction/transactionHistory", {
              user,
              ownerBranch: { branch: user.branch },
              transactions
            });
          })
          .catch(err => next(err));
      }
    })
    .catch(err => next(err));
});

router.post('/cashReceivable', (req, res, next) => {
  const { selectedUserId, selectedUserType, amount, date, paymentType, reference } = req.body;

  if (!selectedUserId || !selectedUserType || !amount || !date || !paymentType) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const amountPaid = Number(amount);

  if (selectedUserType === 'customer') {
    Customer.findById(selectedUserId)
      .then(customer => {
        if (!customer) return res.status(404).json({ error: 'Customer not found' });

        const expectedAmount = customer.total_debt || 0;
        const newRemaining = Math.max(0, expectedAmount - amountPaid);

        // Add to transaction history
        customer.transactions.push({
          product: 'Debt Repayment',
          qty: 0,
          rate: 0,
          total: expectedAmount,
          paid_amount: amountPaid,
          remaining_amount: newRemaining,
          date,
          paymentType,
          reference
        });

        // Update customer debt fields
        customer.total_debt = newRemaining;
        customer.remaining_amount = newRemaining;

        return customer.save().then(() => {
          const cash = new CashReceivable({
            transactionType: 'Customer',
            userId: customer._id,
            expectedAmount,
            amountReceived: amountPaid,
            balanceRemaining: newRemaining,
            paymentDate: new Date(date),
            paymentType,
            reference
          });

          return cash.save().then(() => {
            res.redirect('/transactionHistory');
          });
        });
      })
      .catch(err => {
        console.error('Customer repayment error:', err);
        next(err);
      });

  } else if (selectedUserType === 'loan') {
    Loan.findById(selectedUserId)
      .then(loaner => {
        if (!loaner) return res.status(404).json({ error: 'Loaner not found' });

        const totalExpected = loaner.loans.reduce((sum, loan) => sum + loan.amount_to_repay, 0);
        const newRemaining = Math.max(0, totalExpected - amountPaid);

        if (loaner.loans.length > 0) {
          loaner.loans[0].amount_to_repay = newRemaining;
        }

        return loaner.save().then(() => {
          const cash = new CashReceivable({
            transactionType: 'Loan',
            userId: loaner._id,
            expectedAmount: totalExpected,
            amountReceived: amountPaid,
            balanceRemaining: newRemaining,
            paymentDate: new Date(date),
            paymentType,
            reference
          });

          return cash.save().then(() => {
            res.redirect('/transactionHistory');
          });
        });
      })
      .catch(err => {
        console.error('Loaner repayment error:', err);
        next(err);
      });

  } else {
    return res.status(400).json({ error: 'Invalid user type' });
  }
});


router.get("/deletetransactionHistory/:id", (req,res)=>{
  CashReceivable.findByIdAndDelete(req.params.id)
  .then(user =>{
      res.redirect("/transactionHistory")
      
  })
  .catch(err => console.log(err))
  
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
          Customer.find({ branch: branchId }).sort({ createdAt: -1 })
            .then(customers => {
              Product.find({ branch: branchId }).sort({ createdAt: -1 })
                .then(products => {
                  res.render("Invoice/addInvoice", {
                    user: user,
                    ownerBranch: { branch: ownerBranch },
                    branches: allBranches || [],
                    customers: customers,
                    products: products
                  });
                })
                .catch(err => {
                  console.error("Error fetching products:", err);
                  next(err);
                });
            })
            .catch(err => {
              console.error("Error fetching customers:", err);
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




router.post("/addInvoice", (req, res, next) => {
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

  const grandTotalNum = Number(grand_total);
  const paidAmountNum = Number(paid_amount);
  const remainingAmount = grandTotalNum - paidAmountNum;

  const items = [];
  let branchDoc;
  let generatedInvoiceNo;
  let savedInvoice;

  Branch.findById(branchId)
    .then(branch => {
      if (!branch) throw { status: 404, message: 'Branch not found' };
      branchDoc = branch;

      const prefix = branch.branch_name.toUpperCase().slice(0, 3);
      const branchPrefix = `INV-${prefix}-`;

      return Invoice.find({ invoice_no: { $regex: `^${branchPrefix}` } })
        .sort({ createdAt: -1 })
        .limit(1)
        .then(([latest]) => {
          let nextNum = 1;
          if (latest && latest.invoice_no) {
            const match = latest.invoice_no.match(/\d+$/);
            if (match) {
              nextNum = parseInt(match[0], 10) + 1;
            }
          }

          const paddedNum = String(nextNum).padStart(3, '0');
          generatedInvoiceNo = `INV-${prefix}-${paddedNum}`;
        });
    })
    .then(() => {
      let promiseChain = Promise.resolve();

      for (let i = 0; i < len; i++) {
        promiseChain = promiseChain.then(() => {
          const productName = product[i];
          const soldQtyRaw = Number(qty[i]);
          const unitCode = unitcode[i];
          const itemRate = Number(rate[i]);
          const itemTotal = Number(total[i]);
          const soldQty = Math.round(soldQtyRaw * 2) / 2;

          return Product.findOne({ product: productName }).then(productDoc => {
            if (!productDoc) throw { status: 404, message: `Product not found: ${productName}` };

            const sellingVariant = productDoc.variants.find(v => v.unitCode === unitCode);
            if (!sellingVariant) throw { status: 400, message: `Unit variant not found for: ${productName}` };

            const firstVariant = productDoc.variants[0];
            const baseEquivalent = soldQty / (sellingVariant.totalInBaseUnit || 1);

            if (baseEquivalent > firstVariant.quantity) {
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

            return productDoc.save();
          });
        });
      }

      return promiseChain;
    })
    .then(() => {
      if (customer_id) {
        return Customer.findById(customer_id).then(customer => {
          if (!customer) throw { status: 404, message: 'Customer not found with provided ID' };

          if (sales_type === 'credit') {
            if ((customer.credit_limit || 0) < remainingAmount) {
              throw { status: 400, message: 'Insufficient credit limit to proceed with credit sale' };
            }
            customer.credit_limit -= remainingAmount;
            customer.total_debt += remainingAmount;
            customer.remaining_amount += remainingAmount;
            customer.credit_sales_count += 1;
          } else {
            if (grandTotalNum >= customer.total_debt) {
              customer.credit_limit += customer.total_debt;
              customer.total_debt = 0;
              customer.remaining_amount = 0;
            }
            customer.cash_sales_count += 1;
          }

          customer.sales_type = sales_type;
          return customer.save();
        });
      } else {
        const newCustomer = new Customer({
          customer_name,
          mobile,
          email,
          address,
          branch: branchId,
          credit_limit: credit_limit || 0,
          total_debt: sales_type === 'credit' ? remainingAmount : 0,
          remaining_amount: sales_type === 'credit' ? remainingAmount : 0,
          sales_type,
          cash_sales_count: sales_type === 'cash' ? 1 : 0,
          credit_sales_count: sales_type === 'credit' ? 1 : 0
        });

        return newCustomer.save();
      }
    })
    .then(customer => {
      const newInvoice = new Invoice({
        invoice_no: generatedInvoiceNo,
        customer_id: customer._id,
        customer_name: customer.customer_name,
        payment_date,
        sales_type,
        discount: Number(discount),
        items,
        paid_amount: paidAmountNum,
        remaining_amount: remainingAmount,
        payment_type,
        grand_total: grandTotalNum,
        branch: branchId,
        createdBy: req.user._id
      });

      return newInvoice.save().then(inv => {
        savedInvoice = inv;

        items.forEach(item => {
          customer.transactions.push({
            product: item.product_name,
            qty: item.qty,
            unit_code: item.unitcode,
            rate: item.rate,
            total: item.total,
            paid_amount: item.total,
            remaining_amount: 0
          });
        });

        return customer.save();
      });
    })
    .then(() => {
      if (sales_type === 'credit') {
        branchDoc.totalCreditSales += grandTotalNum;
        branchDoc.totalDebtorsPayment += remainingAmount > 0 ? remainingAmount : 0;
      } else if (sales_type === 'cash') {
        branchDoc.totalCashSalesAmount += paidAmountNum;
      }

      branchDoc.totalSales = branchDoc.totalCashSalesAmount + branchDoc.totalCreditSales;
      return branchDoc.save();
    })
    .then(() => {
      res.redirect(`/receipt/${savedInvoice._id}`);
    })
    .catch(err => {
      console.error('AddInvoice error:', err);
      next(err);
    });
});




// GET /receipt/:invoiceId
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






router.get("/print-receipt", (req, res) => {
  res.render("Invoice/receipt")
});








router.get("/manageInvoice", (req, res) => {
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
                  Invoice.find()
                    .populate('customer_id')
                    .then(invoices => {
                      console.log(invoices);
                      res.render("Invoice/manageInvoice", {
                        
                        user: user,
                        ownerBranch: { branch: ownerBranch },
                        branches: allBranches,
                        invoices
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
         Invoice.find()
         .then(invoices => {
          res.render("Invoice/manageInvoice", {
            user: user,
            ownerBranch: { branch: user.branch },
            invoices
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







router.get('/search-products', async (req, res) => {
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
        Supplier.find({ branch: user.branch._id })
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


router.get("/received-stock", (req, res)=>{
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
                  ReceivedStock.find()
                  .populate('supplier branch')
                    .then(stock => {
                      res.render("ReceivedStock/received-stock", {
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
         ReceivedStock.find()
         .populate('supplier branch')
         .then(stock => {
          res.render("ReceivedStock/received-stock", {
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
})

router.post('/addReceiveStock', (req, res) => {
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
        branch: branch,
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
          console.error('Error saving received stock:', err);
          res.status(500).send('Server error');
        });
    }

    const total = parseFloat(qtys[currentIndex]) * parseFloat(rates[currentIndex]);
    grandTotal += total;

    items.push({
      product: ids[currentIndex],
      item_name: names[currentIndex],
      unitCode: units[currentIndex],
      item_qty: qtys[currentIndex],
      item_rate: rates[currentIndex],
      item_total: total
    });

    Product.findById(ids[currentIndex])
      .then(product => {
        if (!product || !product.variants || product.variants.length === 0) return;

        const variants = product.variants;
        const baseIndex = variants.findIndex(v => v.unitCode === units[currentIndex]);
        if (baseIndex === -1) return;

        variants[baseIndex].quantity += parseFloat(qtys[currentIndex]);

        // Update supplierPrice only on product level
        product.supplierPrice = parseFloat(rates[currentIndex]);

        let prevQty = variants[baseIndex].quantity;
        for (let j = baseIndex + 1; j < variants.length; j++) {
          prevQty = prevQty * variants[j].totalInBaseUnit;
          variants[j].quantity = prevQty;
        }

        return product.save();
      })
      .then(() => {
        currentIndex++;
        processNextProduct();
      })
      .catch(err => {
        console.error('Error updating product:', err);
        res.status(500).send('Server error');
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

router.get("/stock-report", (req, res) => {
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
                  res.render("Report/stockreport", {
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
          res.render("Report/stockreport", {
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

router.get("/creditors-report", (req, res) => {
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
                  res.render("Report/creditorsReport", {
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
          res.render("Report/creditorsReport", {
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

router.get("/debitor-report", (req, res) => {
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
                  res.render("Report/debitorReport", {
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
          res.render("Report/debitorReport", {
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



// router.get("/error-404", (req, res) => {
//   res.render("Auth/error", { user: req.user });
// });




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

    req.logIn(user, function (err) {
      if (err) return next(err);

      StaffLog.create({
        user: user._id,
        role: user.role,
        signInTime: new Date()
      })
        .then((log) => {
          req.session.staffLogId = log._id;
          return res.redirect("/dashboard");
        })
        .catch((logErr) => {
          console.error("Failed to create staff log:", logErr);
          return res.redirect("/dashboard"); // proceed even if log fails
        });
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
