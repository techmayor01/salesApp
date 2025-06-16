require("dotenv").config();

const express = require("express");
const app = express();

// SETTING UP STATIC FOLDER AND VIEW ENGINE 
app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const mongoose = require("mongoose");
const mongodb = require("mongodb");


mongoose
  .connect(process.env.DB)
  .then((done) => {
    let port = process.env.PORT || 3001;
    if(port == null || port == ""){
      port = 3001
    }
    app.listen(port, () => console.log(`Server running on Port ${port}`));
    console.log("Db connected");
  })
.catch((err) => console.log(err));
                     
                        app.get("/Report/expenseLedger", (req, res) => {
                          res.render("Report/expenseLedger", {});
                        });

                     



app.post("/addExpensesInvoice", (req, res) => {
  console.log(req.body);
});







app.use(require("./route/auth"));

app.use((err, req, res, next) => {
  const backUrl = req.get('Referer') || '/';

  res.status(err.status || 500).render('Auth/error', {
    error: {
      status: err.status || 500,
      message: err.message || "Internal Server Error",
      stack: process.env.NODE_ENV === 'production' ? null : err.stack
    },
    backUrl
  });
});

