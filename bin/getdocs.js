#!/usr/bin/env node
var fs = require("fs")
var glob = require("glob")
var getdocs = require("../src")

var items = {}

process.argv.slice(2).forEach(function(arg) {
  glob.sync(arg).forEach(function(filename) {
    getdocs.gather(fs.readFileSync(filename, "utf8"), {filename: filename, items: items})
  })
})

console.log(JSON.stringify(items, null, 2))
