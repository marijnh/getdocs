var parseType = require("./parsetype")
var findDocComments = require("./doccomments")

exports.gather = function(text, filename, items) {
  if (!items) items = {}

  var ast = findDocComments(text, filename, parseComment, {
    // FIXME destructuring
    VariableDeclaration: function(node, data) {
      var decl0 = node.declarations[0]
      return add(items, decl0.id.name, inferExpr(decl0.init, data, node.kind, decl0.id.name))
    },

    VariableDeclarator: function(node, data, ancestors) {
      var kind = ancestors[ancestors.length - 2].kind
      return add(items, node.id.name, inferExpr(node.init, data, kind, node.id.name))
    },

    FunctionDeclaration: function(node, data) {
      return add(items, node.id.name, inferFn(node, data, "function", node.id.name))
    },

    ClassDeclaration: function(node, data) {
      return add(items, node.id.name, inferClass(node, data))
    },

    AssignmentExpression: function(node, data, ancestors) {
      var target = findLVal(items, node.left, ancestors)
      extend(data, target)
      inferExpr(node.right, target, null, propName(node.left))
    },

    Property: function(node, data, ancestors) {
      var parent = findParent(items, ancestors), name = propName(node, true)
      add(deref(parent, "properties"), name, inferExpr(node.value, data, null, name))
    },

    MethodDefinition: function(node, data, ancestors) {
      var parent = findParent(items, ancestors)
      if (node.kind == "constructor") {
        parent.constructor = inferFn(node.value, data, "constructor")
      } else {
        var prop = node.static ? "properties" : "instanceProperties"
        add(deref(parent, prop), propName(node),
            inferFn(node.value, data, node.kind == "get" ? "getter" : node.kind == "set" ? "setter" : "method"))
      }
    },

    ExportNamedDeclaration: function(node, data, ancestors) {
      data = this[node.declaration.type](node.declaration, data, ancestors)
      if (!data) console.log("OW", node.declaration.type)
      data.exported = true
    },

    ExportDefaultDeclaration: function(node, data, ancestors) {
      var decl = node.declaration
      if (this[decl.type]) {
        data = this[decl.type](decl, data, ancestors)
        delete items[decl.id.name]
        items.default = data
      } else {
        data = add(items, "default", inferExpr(decl, data))
      }
      data.exported = true
    }
  })

  // Mark locals exported with `export {a, b, c}` statements as exported
  for (var i = 0; i < ast.body.length; i++) {
    var node = ast.body[i]
    if (node.type == "ExportNamedDeclaration" && !node.source) {
      for (var j = 0; j < node.specifiers.length; j++) {
        var spec = node.specifiers[j]
        var known = items[spec.local.name]
        if (known) known.exported = true
      }
    }
  }

  return items
}

function raise(msg, node) {
  throw new SyntaxError(msg + " at " + node.loc.source.name + ":" + node.loc.start.line)
}

function propName(node, force) {
  var key = node.key || node.property
  if (!node.computed && key.type == "Identifier") return key.name
  if (key.type == "Literal") {
    if (typeof key.value == "string") return key.value
    if (typeof key.value == "number") return String(key.value)
  }
  if (node.computed && key.type == "MemberExpression" &&
      !key.computed && key.object.name == "Symbol")
    return key.property.name
  if (force) raise("Expected static property", node)
}

function parseComment(node, text) {
  var match = /^\s*(;;|::)\s*/.exec(text)
  var data, pos = match[0].length
  if (match[1] == "::") {
    var parsed = parseType(text, pos, node.loc)
    data = parsed.type
    pos = parsed.end
  } else {
    data = {}
  }
  data.file = node.loc.source.name
  data.loc = node.loc.start
  text = text.slice(pos)
  while (match = /^\s*#(\w+)(?:=(\w+|"(?:[^"\\]|\\.)*"))?\s*/.exec(text)) {
    text = text.slice(match[0].length)
    var value = match[2] || "true"
    if (value.charAt(0) == '"') value = JSON.parse(value)
    deref(data, "tags")[match[1]] = value
  }
  if (/\S/.test(text)) data.description = text
  return data
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
  return found || data
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

function inferFn(node, data, kind, name) {
  if (kind) data.kind = kind
  var inferredParams = node.params.map(inferParam)

  if (!data.type) {
    data.type = "Function"
    data.params = inferredParams
  } else if (data.type == "Function") {
    for (var i = 0, e = Math.min(data.params.length, node.params.length); i < e; i++) {
      var from = inferredParams[i], to = data.params[i]
      for (var prop in from) if (!to.hasOwnProperty(prop)) to[prop] = from[prop]
    }
  }
  if (node.generator) data.generator = true

  if (name && /^[A-Z]/.test(name)) {
    data.kind = "constructor"
    return {constructor: data, kind: "class", file: node.loc.source.name, loc: node.loc.start}
  } else {
    return data
  }
}

function inferClass(node, data) {
  data.kind = "class"
  if (node.superClass && node.superClass.type == "Identifier")
    data.extends = node.superClass.name
  return data
}

function inferExpr(node, data, kind, name) {
  if (kind) data.kind = kind
  if (!node) return data
  if (node.type == "ClassExpression")
    inferClass(node, data)
  else if (node.type == "FunctionExpression" || node.type == "ArrowFunctionExpression")
    inferFn(node, data, "function", name)
  return data
}

// Deriving context from ancestor nodes

function deref(obj, name) {
  return obj[name] || (obj[name] = {})
}

function findLVal(items, lval, ancestors) {
  var path = [], target, inst = false
  while (lval.type == "MemberExpression" && !lval.computed) {
    path.push(lval.property.name)
    lval = lval.object
  }
  if (lval.type == "Identifier") {
    target = deref(items, lval.name)
  } else if (lval.type == "ThisExpression") {
    target = findSelf(items, ancestors.slice(0, ancestors.length - 1))
    inst = true
  }

  for (var i = path.length - 1; i >= 0; i--) {
    var name = path[i], descend = inst ? "instanceProperties" : "properties"
    if (name == "prototype" && i) {
      name = path[--i]
      descend = "instanceProperties"
    }
    target = deref(deref(target, descend), name)
    inst = false
  }
  return target
}

function findAssigned(items, ancestors) {
  var top = ancestors[ancestors.length - 1]
  if (top.type == "VariableDeclarator" && top.id.type == "Identifier")
    return deref(items, top.id.name)
  else if (top.type == "AssignmentExpression")
    return findLVal(items, top.left, ancestors)
  else
    raise("Could not derive a name", top)
}

function assignedName(node) {
  if (node.type == "VariableDeclarator" && node.id.type == "Identifier")
    return node.id.name
  else if (node.type == "AssignmentExpression")
    return propName(node.left) || ""
  else
    return ""
}

function findPrototype(items, ancestors) {
  var assign = ancestors[ancestors.length - 1]
  if (assign.type != "AssignmentExpression") return null
  for (var i = 0, lval = assign.left; i < 2; i++) {
    if (lval.type != "MemberExpression" || lval.computed) return null
    if (lval.property.name == "prototype")
      return findLVal(items, lval.object, ancestors)
    lval = lval.object
  }
}

function findSelf(items, ancestors) {
  for (var i = ancestors.length - 1; i >= 0; i--) {
    var ancestor = ancestors[i], found
    if (ancestor.type == "ClassDeclaration")
      return deref(items, ancestor.id.name)
    else if (ancestor.type == "FunctionDeclaration" && /^[A-Z]/.test(ancestor.id.name))
      return deref(items, ancestor.id.name)
    else if (i && (ancestor.type == "ClassExpression" ||
                   ancestor.type == "FunctionExpression" && /^[A-Z]/.test(assignedName(ancestors[i - 1]))))
      return findAssigned(items, ancestors.slice(0, i))
    else if (i && /Function/.test(ancestor.type) &&
             (found = findPrototype(items, ancestors.slice(0, i))))
      return found
  }
  raise("No context found for 'this'", ancestors[ancestors.length - 1])
}

function findParent(items, ancestors) {
  for (var i = ancestors.length - 1; i >= 0; i--) {
    var ancestor = ancestors[i]
    if (ancestor.type == "ClassDeclaration")
      return deref(items, ancestor.id.name)
    else if (i && (ancestor.type == "ClassExpression" || ancestor.type == "ObjectExpression"))
      return findAssigned(items, ancestors.slice(0, i))
  }
}
