var acorn = require("acorn/dist/acorn")
var walk = require("acorn/dist/walk")

var commentsBefore = require("./commentsbefore")
var parseType = require("./parsetype")


exports.gather = function(text, filename, items) {
  if (!items) items = {}
  var ast = acorn.parse(text, {
    ecmaVersion: 6,
    locations: true,
    sourceFile: {text: text, name: filename},
    sourceType: "module"
  })

  walk.simple(ast, {
    VariableDeclaration: function(node) {
      var above = get(node), decl0 = node.declarations[0]
      if (above) add(items, decl0.id.name, inferExpr(decl0.init, above, node.kind))
      for (var i = above ? 1 : 0; i < node.declarations.length; i++) {
        var decl = node.declarations[i], data = get(decl)
        if (data) add(items, decl.id.name, inferExpr(decl.init, data, node.kind))
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
      var data = get(node)
      if (!data) return
      var path = [], left = node.left
      while (left.type == "MemberExpression" && !left.computed) {
        path.push(left.property.name)
        left = left.object
      }
      if (left.type != "Identifier") return
      path.push(left.name)
      var target = items
      for (var i = path.length - 1; i > 0; i--) {
        var name = path[i]
        var obj = target[name] || (target[name] = {})
        var descend = "properties"
        if (i > 1 && path[i - 1] == "prototype") {
          descend = "instanceProperties"
          i--
        }
        target = obj[descend] || (obj[descend] = {})
      }
      add(target, path[0], inferExpr(node.right, data))
    }
  })
  return items
}

function getDescription(comments, remove) {
  var out = ""
  for (var i = 0; i < comments.length; i++) {
    var cur = i ? comments[i] : comments[i].slice(remove)
    if (/\S/.test(cur))
      out += (out ? "\n\n" : "") + cur
  }
  return out
}

function get(node) {
  var comments = commentsBefore(node.loc.source.text, node.start), m
  for (var i = comments.length - 1; i >= 0; i--) {
    var decl = /^\s*(:[-:])/.exec(comments[i])
    if (!decl) continue
    var data, descStart
    if (decl[1] == "::") {
      var parsed = parseType(comments[i], decl[0].length, node.loc)
      data = parsed.type
      descStart = parsed.end
    } else {
      data = {}
      descStart = decl[0].length
    }
    var desc = getDescription(comments.slice(i), descStart)
    if (desc) data.description = desc
    data.file = node.loc.source.name
    data.loc = node.loc.start
    return data
  }
}

function extend(from, to, path) {
  for (var prop in from) {
    if (!to.hasOwnProperty(prop)) {
      to[prop] = from[prop]
    } else if (prop == "properties" || prop == "instanceProperties") {
      extend(from[prop], to[prop], path + "." + prop)
    } else {
      throw new SyntaxError("Conflicting information for " + path + "." + prop)
    }
  }
}

function add(items, name, data) {
  var found = items[name]
  if (!found)
    items[name] = data
  else
    extend(data, found, name)
}

function inferParam(n) {
  var param = {type: "any"}
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
  if (kind) data.kind = kind
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
    add(data[prop] || (data[prop] = {}), item.key.name, itemData)
  }
  return data
}

function inferExpr(node, data, kind) {
  if (kind) data.kind = kind
  if (!node) return data
  if (node.type == "ObjectExpression")
    inferObj(node, data)
  else if (node.type == "ClassExpression")
    inferClass(node, data)
  else if (node.type == "FunctionExpression" || node.type == "ArrowFunctionExpression")
    inferFn(node, data, "function")
  return data
}

function inferObj(node, data) {
  for (var i = 0; i < node.properties.length; i++) {
    var prop = node.properties[i]
    if (prop.computed || prop.key.type != "Identifier") continue
    var propData = get(prop)
    if (!propData) continue
    add(data.properties || (data.properties = {}), prop.key.name, inferExpr(prop.value, propData))
  }
  return data
}
