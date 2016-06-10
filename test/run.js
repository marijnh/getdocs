var fs = require("fs")

var getdocs = require("../src")

var filter = process.argv[2]

fs.readdirSync(__dirname).forEach(function(filename) {
  var isJSON = /^([^\.]+)\.json$/.exec(filename)
  if (!isJSON || (filter && isJSON[1].indexOf(filter) != 0)) return

  var expected = JSON.parse(fs.readFileSync(__dirname + "/" + filename, "utf8"))
  var jsfile = "/" + isJSON[1] + ".js"
  var returned = getdocs.gather(fs.readFileSync(__dirname + jsfile, "utf8"), "test" + jsfile)
  try {
    compare(returned, expected, "")
  } catch(e) {
    console.error(isJSON[1] + ": " + e.message)
    console.error("in " + JSON.stringify(returned, null, 2))
  }
})

function hop(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop)
}

function compare(a, b, path) {
  if (typeof a != "object" || typeof b != "object") {
    if (a !== b) throw new Error("Mismatch at " + path + ": " + a + " vs " + b)
  } else {
    for (var prop in a) if (hop(a, prop)) {
      if (!(prop in b))
        throw new Error("Unexpected property " + path + "." + prop)
      else
        compare(a[prop], b[prop], path + "." + prop)
    }
    for (var prop in b) if (hop(b, prop)) {
      if (!(prop in a))
        throw new Error("Missing property " + path + "." + prop)
    }
  }
}
