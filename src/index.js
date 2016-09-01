var docComments = require("./doccomments")
var parseType = require("./parsetype")

exports.gather = function(text, filename, items) {
  if (!items) items = Object.create(null)
  var top = {properties: items}

  var found = docComments.parse(text, filename)

  found.comments.forEach(function(comment) {
    var data = comment.parsed.data

    if (comment.parsed.name) {
      var stack = docComments.findNodeAround(found.ast, comment.end, findPath)
      path = addNameToPath(comment.parsed.name, getPath(stack), data.$static)
    } else {
      var stack = docComments.findNodeAfter(found.ast, comment.end, findPath)
      var node = stack && stack[stack.length - 1]
      if (!node || !/^(?:[;{},\s]|\/\/.*|\/\*.*?\*\/)*$/.test(text.slice(node.end, comment.start)))
        throw new SyntaxError("Misplaced documentation block at " + filename + ":" + comment.startLoc.line)
      if (inferForNode.hasOwnProperty(node.type)) data = inferForNode[node.type](node, data, stack)
      var path = getPath(stack)
    }

    var stored = addData(top, path, data)

    comment.parsed.subcomments.forEach(function(sub) { applySubComment(stored, sub) })
  })

  // Mark locals exported with `export {a, b, c}` statements as exported
  for (var i = 0; i < found.ast.body.length; i++) {
    var node = found.ast.body[i]
    if (node.type == "ExportNamedDeclaration" && !node.source) {
      for (var j = 0; j < node.specifiers.length; j++) {
        var spec = node.specifiers[j]
        var known = items[spec.local.name]
        if (known) known.exported = true
      }
    }
  }

  assignIds(top)

  return items
}

function applySubComment(parent, sub) {
  var target
  if (parent.type == "Function") {
    if (sub.name == "return")
      target = parent.returns
    else if (parent.params) for (var i = 0; i < parent.params.length; i++)
      if (parent.params[i].name == sub.name) target = parent.params[i]
    if (!target) raise("Unknown parameter " + sub.name, sub.data.loc)
  } else if (parent.type == "class" || parent.type == "interface" || parent.type == "Object") {
    var path = splitPath(sub.name), target = parent
    for (var i = 0; i < path.length; i++) {
      var isStatic = i == path.length - 1 && sub.data.$static
      target = deref(deref(target, isStatic ? "staticProperties" : "properties"), path[i])
    }
  } else {
    raise("Can not add sub-fields to named type " + parent.type, sub.data.loc)
  }
  var stored = extend(sub.data, target, [sub.name], true)
  sub.subcomments.forEach(function(sub) { applySubComment(stored, sub) })
}

function getPath(ancestors) {
  var top = ancestors[ancestors.length - 1]
  return top ? findPath[top.type](top, ancestors) : []
}

var findPath = {
  // FIXME destructuring
  VariableDeclaration: function(node) { return [node.declarations[0].id.name] },

  VariableDeclarator: function(node) { return [node.id.name] },

  FunctionDeclaration: function(node) { return [node.id.name] },

  ClassDeclaration: function(node) { return [node.id.name] },

  AssignmentExpression: function(node, ancestors) {
    return lvalPath(node.left, ancestors)
  },

  Property: function(node, ancestors) {
    var path = parentPath(ancestors)
    path.push(propName(node, true))
    return path
  },

  MethodDefinition: function(node, ancestors) {
    var path = parentPath(ancestors)
    if (node.kind == "constructor") {
      path.push("#constructor")
    } else {
      if (!node.static) path.push("prototype")
      path.push(propName(node, true))
    }
    return path
  },

  ExportNamedDeclaration: function(node, ancestors) {
    return this[node.declaration.type](node.declaration, ancestors)
  },

  ExportDefaultDeclaration: function() {
    return ["default"]
  }
}

function addNameToPath(name, path, isStatic) {
  var parts = splitPath(name)
  for (var i = 0; i < parts.length; i++) {
    if (path.length && ctorName(path[path.length - 1]) && (!isStatic || i < parts.length - 1))
      path.push("prototype")
    path.push(parts[i])
  }
  return path
}

function addData(top, path, data) {
  var target = top, isCtor = false
  for (var i = 0; i < path.length; i++) {
    var cur = path[i], descend = "properties"
    if (cur == "#constructor") {
      target = deref(target, "constructor")
      break
    }
    if (isCtor) {
      if (cur == "prototype") {
        if (i == path.length - 1) raise("Can not annotate constructor prototype", data.loc)
        cur = path[++i]
      } else {
        descend = "staticProperties"
      }
    }
    target = deref(deref(target, descend), cur)
    isCtor = target.type ? target.type == "class" : ctorName(cur)
  }
  return extend(data, target, path)
}

var inferForNode = {
  VariableDeclaration: function(node, data) {
    var decl0 = node.declarations[0]
    return inferExpr(decl0.init, data, decl0.id.name)
  },

  VariableDeclarator: function(node, data) {
    return inferExpr(node.init, data, node.id.name)
  },

  FunctionDeclaration: function(node, data) {
    return inferFn(node, data, node.id.name)
  },

  ClassDeclaration: inferClass,
  ClassExpression: inferClass,

  AssignmentExpression: function(node, data) {
    return inferExpr(node.right, data, propName(node.left))
  },

  Property: function(node, data) {
    return inferExpr(node.value, data, propName(node, true))
  },

  MethodDefinition: function(node, data) {
    return inferFn(node.value, data)
  },

  ExportNamedDeclaration: function(node, data, ancestors) {
    var inner = this[node.declaration.type](node.declaration, data, ancestors)
    inner.exported = true
    return inner
  },

  ExportDefaultDeclaration: function(node, data, ancestors) {
    var decl = node.declaration
    if (this[decl.type])
      data = this[decl.type](decl, data, ancestors)
    else
      data = inferExpr(decl, data)
    data.exported = true
    return data
  }
}

function raise(msg, loc) {
  throw new SyntaxError(msg + " at " + (loc.file || loc.source.name) + ":" + (loc.start ? loc.start.line : loc.line))
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
    return "[Symbol." + key.property.name + "]"
  if (force) raise("Expected static property", node.loc)
}

function inferParam(n) {
  var param = Object.create(null)
  param.type = "any"
  param.loc = n.loc.start
  param.loc.file = n.loc.source.name
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

function ctorName(name) {
  return name && /^[A-Z]/.test(name)
}

function inferFn(node, data, name) {
  var inferredParams = node.params.map(inferParam)

  if (!data.type) {
    data.type = "Function"
    data.params = inferredParams
  } else if (data.type == "Function") {
    for (var i = 0, e = Math.min(data.params.length, node.params.length); i < e; i++) {
      var from = inferredParams[i], to = data.params[i]
      for (var prop in from) if (!(prop in to)) to[prop] = from[prop]
    }
  }
  if (node.generator) data.generator = true

  if (ctorName(name)) {
    return {constructor: data, type: "class", loc: data.loc}
  } else {
    return data
  }
}

function inferClass(node, data) {
  if (node.superClass && node.superClass.type == "Identifier") {
    var loc = node.superClass.loc
    loc.start.file = loc.source.name
    data.extends = parseType(node.superClass.name, 0, loc.start).type
  }
  if (!data.type) data.type = "class"
  return data
}

function inferExpr(node, data, name) {
  if (!node) return data
  if (node.type == "ClassExpression") {
    inferClass(node, data)
  } else if (node.type == "FunctionExpression" || node.type == "ArrowFunctionExpression") {
    inferFn(node, data, name)
  } else if (node.type == "Literal" && !data.type) {
    if (typeof node.value == "number") data.type = "number"
    else if (typeof node.value == "boolean") data.type = "bool"
    else if (typeof node.value == "string") data.type = "string"
    else if (node.value instanceof RegExp) data.type = "RegExp"
  } else if (node.type == "NewExpression" && !data.type) {
    if (node.callee.type == "Identifier" && ctorName(node.callee.name))
      data.type = node.callee.name
  }
  return data
}

// Deriving context from ancestor nodes

function extend(from, to, path, overrideLoc) {
  for (var prop in from) {
    if (!(prop in to) || (prop == "loc" && overrideLoc)) {
      to[prop] = from[prop]
    } else if (prop == "properties" || prop == "staticProperties") {
      extend(from[prop], to[prop], path.concat(prop))
    } else {
      var msg = "Conflicting information for " + path.join(".") + "." + prop
      if (to.loc) msg += " at " + to.loc.file + ":" + to.loc.line
      if (from.loc) msg += (to.loc ? " and " : " at ") + from.loc.file + ":" + from.loc.line
      throw new SyntaxError(msg)
    }
  }
  return to
}

function deref(obj, name) {
  return obj[name] || (obj[name] = Object.create(null))
}

function assignIds(obj, path) {
  if (path) obj.id = path
  if (Object.prototype.hasOwnProperty.call(obj, "constructor"))
    assignIds(obj.constructor, path + ".constructor")
  if (obj.properties) for (var prop in obj.properties)
    assignIds(obj.properties[prop], (path ? path + "." : "") + prop)
  if (obj.staticProperties) for (var prop in obj.staticProperties)
    assignIds(obj.staticProperties[prop], path + "^" + prop)
  if (obj.params) for (var i = 0; i < obj.params.length; i++)
    if (obj.params[i].name) assignIds(obj.params[i], path + "^" + obj.params[i].name)
  if (obj.returns) assignIds(obj.returns, path + "^returns")
}

function lvalPath(lval, ancestors) {
  var path = []
  while (lval.type == "MemberExpression") {
    path.unshift(propName(lval))
    lval = lval.object
  }

  if (lval.type == "Identifier") {
    path.unshift(lval.name)
  } else if (lval.type == "ThisExpression") {
    path = selfPath(ancestors.slice(0, ancestors.length - 1)).concat(path)
  } else {
    raise("Could not derive a target for this assignment", lval.loc)
  }
  return path
}

function assignedPath(ancestors) {
  var top = ancestors[ancestors.length - 1]
  if (top.type == "VariableDeclarator" && top.id.type == "Identifier")
    return [top.id.name]
  else if (top.type == "AssignmentExpression")
    return lvalPath(top.left, ancestors)
  else
    raise("Could not derive a name", top.loc)
}

function findPrototype(ancestors) {
  var assign = ancestors[ancestors.length - 1]
  if (assign.type != "AssignmentExpression") return null
  var lval = assign.left
  if (lval.type == "MemberExpression" && !lval.computed &&
      lval.object.type == "MemberExpression" && !lval.object.computed &&
      lval.object.property.name == "prototype")
    return lvalPath(lval.object, ancestors)
}

function assignedName(node) {
  if (node.type == "VariableDeclarator" && node.id.type == "Identifier")
    return node.id.name
  else if (node.type == "AssignmentExpression")
    return propName(node.left)
}

function selfPath(ancestors) {
  for (var i = ancestors.length - 1; i >= 0; i--) {
    var ancestor = ancestors[i], found
    if (ancestor.type == "ClassDeclaration" ||
        (ancestor.type == "FunctionDeclaration" && ctorName(ancestor.id.name)))
      return [ancestor.id.name, "prototype"]
    else if (i && (ancestor.type == "ClassExpression" ||
                   ancestor.type == "FunctionExpression" && ctorName(assignedName(ancestors[i - 1]))))
      return assignedPath(ancestors.slice(0, i)).concat("prototype")
    else if (i && /Function/.test(ancestor.type) && (found = findPrototype(ancestors.slice(0, i))))
      return found
  }
  raise("No context found for 'this'", ancestors[ancestors.length - 1].loc)
}

function parentPath(ancestors) {
  for (var i = ancestors.length - 1; i >= 0; i--) {
    var ancestor = ancestors[i]
    if (ancestor.type == "ClassDeclaration")
      return [ancestor.id.name]
    else if (i && (ancestor.type == "ClassExpression" || ancestor.type == "ObjectExpression"))
      return assignedPath(ancestors.slice(0, i))
  }
}

function splitPath(path) {
  var m, parts = [], rest = path
  while (rest && (m = /^(\[.*?\]|[^\s\.#]+)(\.)?/.exec(rest))) {
    parts.push(m[1])
    rest = rest.slice(m[0].length)
    if (!m[2]) break
  }
  if (rest) throw new Error("Invalid path: " + path)
  return parts
}
