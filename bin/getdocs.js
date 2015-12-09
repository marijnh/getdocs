var fs = require("fs")
var glob = require("glob")
var getdocs = require("../src")

var items = Object.create(null)

process.argv.slice(2).forEach(function(arg) {
  glob.sync(arg).forEach(function(filename) {
    var file = {name: filename, text: fs.readFileSync(filename, "utf8")}
    getdocs.gather(items, file)
  })
})

console.log(JSON.stringify(items, null, 2))
