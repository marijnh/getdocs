var acorn = require("acorn/dist/acorn")
var walk = require("acorn/dist/walk")

var commentsBefore = require("./commentsbefore")
var parseType = require("./parsetype")


exports.gather = function(items, file) {
  var ast = acorn.parse(file.text, {ecmaVersion: 6, locations: true, sourceFile: file})
  walk.simple(ast, {
    VariableDeclaration: function(node) {
      var above = get(node)
      if (above) {
        above.kind = node.kind
        add(items, node.declarations[0].id.name, above)
      }
      for (var i = above ? 1 : 0; i < node.declarations.length; i++) {
        var decl = node.declarations[i], data = get(decl)
        if (data) {
          decl.kind = node.kind
          add(items, decl.id.name, data)
        }
      }
    },
    FunctionDeclaration: function(node) {
      var data = get(node)
      if (data) add(items, node.id.name, inferFn(node, data, "function"))
    },
    ClassDeclaration: function(node) {
      var data = get(node)
      if (data) add(items, node.id.name, inferClass(node, data))
    },
    AssignmentExpression: function(node) {
      // FIXME also if rhs is objectexpression or classexpression, check properties
    }
  })
}

function get(node) {
  var comments = commentsBefore(node.loc.source.text, node.start), m
  for (var i = comments.length - 1; i >= 0; i--) {
    if (m = /^\s*::\s*(.*)/.exec(comments[i])) {
      var data = parseType(m[1], node.loc)
      data.description = comments.slice(i + 1).join("\n\n")
      return data
    } else if (m = /^\s*:-((?:\s|^).*)/.exec(comments[i])) {
      return {description: (m[1] ? [m[1]] : []).concat(comments.slice(i + 1)).join("\n\n")}
    }
  }
}

function add(items, name, data) {
  if (items[name]) throw new SyntaxError("Duplicate documentation for " + name)
  items[name] = data
}

function inferParam(n) {
  var param = {type: {type: "any"}}
  if (n.type == "RestElement") {
    param.rest = true
    n = n.argument
  }
  if (n.type == "AssignmentPattern") {
    if (n.right.end - n.right.start < 20)
      param.default = n.loc.source.text.slice(n.right.start, n.right.end)
    n = n.left
    param.optional = true
  }
  if (n.type == "Identifier") param.name = n.name
  return param
}

function inferFn(node, data, kind) {
  data.kind = kind
  var inferredParams = node.params.map(inferParam)

  if (!data.type) {
    data.type = "function"
    data.params = inferredParams
  } else if (data.type == "function") {
    for (var i = 0, e = Math.min(data.params.length, node.params.length); i < e; i++) {
      var from = inferredParams[i], to = data.params[i]
      for (var prop in from) if (!to.hasOwnProperty(prop)) to[prop] = from[prop]
    }
  }
  if (node.generator) data.generator = true
  return data
}

function inferClass(node, data) {
  data.kind = "class"
  data.instanceProperties = {}
  if (node.superClass && node.superClass.type == "Identifier")
    data.extends = node.superClass.name
  for (var i = 0; i < node.body.body.length; i++) {
    var item = node.body.body[i]
    if (item.computed || item.key.type != "Identifier" || item.kind == "set") continue
    var itemData = get(item)
    if (item.kind == "constructor") {
      if (!itemData) itemData = {}
      data.constructor = inferFn(item.value, itemData, "constructor")
      continue
    }
    if (!itemData) continue
    inferFn(item.value, itemData, item.kind == "get" ? "getter" : "method")
    var prop = item.static ? "properties" : "instanceProperties"
    ;(data[prop] || (data[prop] = {}))[item.key.name] = itemData
  }
  return data
}
