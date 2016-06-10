var docComments = require("./doccomments")
var parseType = require("./parsetype")

exports.gather = function(text, filename, items) {
  if (!items) items = Object.create(null)

  var found = docComments.parse(text, filename)

  var findPos = findPosFor(items)

  found.comments.forEach(function(comment) {
    var data = comment.parsed.data, pos

    if (comment.parsed.name) {
      var stack = docComments.findNodeAround(found.ast, comment.end, findPos)
      pos = posFromPath(findParent(items, stack) || items, splitPath(comment.parsed.name))
    } else {
      var stack = docComments.findNodeAfter(found.ast, comment.end, findPos)
      var top = stack && stack[stack.length - 1]
      if (!top || !/^(?:[;{},\s]|\/\/.*|\/\*.*?\*\/)*$/.test(text.slice(top.end, comment.start)))
        throw new SyntaxError("Misplaced documentation block at " + filename + ":" + comment.startLoc.line)

      pos = findPos[top.type](top, stack)
      if (inferForNode.hasOwnProperty(top.type)) data = inferForNode[top.type](top, data, stack)
    }
    var stored = pos.add(data)

    comment.parsed.subcomments.forEach(sub => applySubComment(stored, sub))
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

  return items
}

function applySubComment(parent, sub) {
  var target
  if (parent.type == "Function") {
    if (sub.name == "return")
      target = parent.returns
    else if (parent.params) for (let i = 0; i < parent.params; i++)
      if (parent.params[i].name == sub.name) target = parent.params[i]
    if (!target) throw new SyntaxError("Unknown parameter " + sub.name + " referenced at " + sub.loc.file + ":" + sub.loc.line)
  } else if (parent.type == "class" || parent.type == "interface" || parent.type == "Object") {
    var path = splitPath(sub.name), target = parent
    for (let i = 0; i < path.length; i++) {
      if (path[i] == "prototype" && i < path.length - 1)
        target = deref(deref(target, "instanceProperties"), path[++i])
      else
        target = deref(deref(target, "properties"), path[i])
    }
  } else {
    throw new SyntaxError("Can not add sub-fields to named type " + parent.type + " at " + sub.loc.file + ":" + sub.loc.line)
  }
  var stored = extend(sub.data, target, sub.name)
  sub.subcomments.forEach(sub => applySubComment(stored, sub))
}

function findPosFor(items) {
  return {
    // FIXME destructuring
    VariableDeclaration: function(node) { return new Pos(items, node.declarations[0].id.name) },

    VariableDeclarator: function(node) { return new Pos(items, node.id.name) },

    FunctionDeclaration: function(node) { return new Pos(items, node.id.name) },

    ClassDeclaration: function(node) { return new Pos(items, node.id.name) },

    AssignmentExpression: function(node, ancestors) {
      return lvalPos(items, node.left, ancestors)
    },

    Property: function(node, ancestors) {
      return new Pos(deref(findParent(items, ancestors), "properties"), propName(node, true))
    },

    MethodDefinition: function(node, ancestors) {
      var parent = findParent(items, ancestors)
      if (node.kind == "constructor")
        return new Pos(parent, "constructor")
      else
        return new Pos(deref(parent, node.static ? "properties" : "instanceProperties"), propName(node, true))
    },

    ExportNamedDeclaration: function(node, ancestors) {
      return this[node.declaration.type](node.declaration, ancestors)
    },

    ExportDefaultDeclaration: function() {
      return new Pos(items, "default")
    }
  }
}

var inferForNode = {
  VariableDeclaration: function(node, data) {
    var decl0 = node.declarations[0]
    return inferExpr(decl0.init, data, decl0.id.name)
  },

  VariableDeclarator: function(node, data, ancestors) {
    return inferExpr(node.init, data, node.id.name)
  },

  FunctionDeclaration: function(node, data) {
    return inferFn(node, data, node.id.name)
  },

  ClassDeclaration: function(node, data) {
    return inferClass(node, data)
  },

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
    return "[Symbol." + key.property.name + "]"
  if (force) raise("Expected static property", node)
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
  return data
}

function inferExpr(node, data, name) {
  if (!node) return data
  if (node.type == "ClassExpression")
    inferClass(node, data)
  else if (node.type == "FunctionExpression" || node.type == "ArrowFunctionExpression")
    inferFn(node, data, name)
  return data
}

// Deriving context from ancestor nodes

function Pos(parent, name) { this.parent = parent; this.name = name }

function extend(from, to, path) {
  for (var prop in from) {
    if (!(prop in to)) {
      to[prop] = from[prop]
    } else if (prop == "properties" || prop == "instanceProperties") {
      extend(from[prop], to[prop], path + "." + prop)
    } else {
      var msg = "Conflicting information for " + path + "." + prop
      if (to.loc) msg += " at " + to.loc.file + ":" + to.loc.line
      if (from.loc) msg += (to.loc ? " and " : " at ") + from.loc.file + ":" + from.loc.line
      throw new SyntaxError(msg)
    }
  }
  return to
}

Pos.prototype.add = function(data) {
  var known = this.parent[this.name]
  return known ? extend(data, known, this.name) : this.parent[this.name] = data
}

Pos.prototype.deref = function() {
  return this.parent[this.name] || (this.parent[this.name] = Object.create(null))
}

function deref(obj, name) {
  return obj[name] || (obj[name] = Object.create(null))
}

function lvalPos(items, lval, ancestors) {
  var path = [], target, name, inst = false
  while (lval.type == "MemberExpression") {
    path.push(propName(lval))
    lval = lval.object
  }

  if (lval.type == "Identifier") {
    if (!path.length) return new Pos(items, lval.name)
    target = deref(items, lval.name)
  } else if (lval.type == "ThisExpression") {
    target = findSelf(items, ancestors.slice(0, ancestors.length - 1))
    inst = true
  } else {
    raise("Could not derive a target for this assignment", lval)
  }

  for (var i = path.length - 1; i >= 0; i--) {
    var name = path[i], descend = inst ? "instanceProperties" : "properties"
    if (name == "prototype" && i) {
      name = path[--i]
      descend = "instanceProperties"
    }
    target = deref(target, descend)
    if (i) target = deref(target, name)
    inst = false
  }
  return new Pos(target, path[0])
}

function findAssigned(items, ancestors) {
  var top = ancestors[ancestors.length - 1]
  if (top.type == "VariableDeclarator" && top.id.type == "Identifier")
    return deref(items, top.id.name)
  else if (top.type == "AssignmentExpression")
    return lvalPos(items, top.left, ancestors).deref()
  else
    raise("Could not derive a name", top)
}

function assignedName(node) {
  if (node.type == "VariableDeclarator" && node.id.type == "Identifier")
    return node.id.name
  else if (node.type == "AssignmentExpression")
    return propName(node.left)
}

function findPrototype(items, ancestors) {
  var assign = ancestors[ancestors.length - 1]
  if (assign.type != "AssignmentExpression") return null
  for (var i = 0, lval = assign.left; i < 2; i++) {
    if (lval.type != "MemberExpression" || lval.computed) return null
    if (lval.property.name == "prototype")
      return lvalPos(items, lval.object, ancestors).deref()
    lval = lval.object
  }
}

function findSelf(items, ancestors) {
  for (var i = ancestors.length - 1; i >= 0; i--) {
    var ancestor = ancestors[i], found
    if (ancestor.type == "ClassDeclaration")
      return deref(items, ancestor.id.name)
    else if (ancestor.type == "FunctionDeclaration" && ctorName(ancestor.id.name))
      return deref(items, ancestor.id.name)
    else if (i && (ancestor.type == "ClassExpression" ||
                   ancestor.type == "FunctionExpression" && ctorName(assignedName(ancestors[i - 1]))))
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

function posFromPath(items, path) {
  var target = items, next = path[0]
  for (var i = 0; i < path.length - 1; i++) {
    var name = next, descend = "properties"
    next = path[i + 1]
    if (i < path.length - 2 && next == "prototype") {
      descend = "instanceProperties"
      i++
      next = path[i + 1]
    }
    target = deref(target, name)
    if (descend) target = deref(target, descend)
  }
  return new Pos(target, next)
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
