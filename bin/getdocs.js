var fs = require("fs")
var glob = require("glob")
var getdocs = require("../src")

var items = Object.create(null)

process.argv.slice(2).forEach(function(arg) {
  glob.sync(arg).forEach(function(filename) {
    getdocs.gather(fs.readFileSync(filename, "utf8"), filename, items)
  })
})

console.log(JSON.stringify(items, null, 2))
