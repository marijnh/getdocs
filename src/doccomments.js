var acorn = require("acorn/dist/acorn")
var walk = require("acorn/dist/walk")

function strip(lines) {
  for (var head, i = 1; i < lines.length; i++) {
    var line = lines[i], lineHead = line.match(/^[\s\*]*/)[0]
    if (lineHead != line) {
      if (head == null) {
        head = lineHead
      } else {
        var same = 0
        while (same < head.length && head.charCodeAt(same) == lineHead.charCodeAt(same)) ++same
        if (same < head.length) head = head.slice(0, same)
      }
    }
  }

  outer: for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\s+$/, "")
    if (i == 0 && head != null) {
      for (var j = 0; j < head.length; j++) {
        var found = line.indexOf(head.slice(j))
        if (found == 0) {
          lines[i] = line.slice(head.length - j)
          continue outer
        }
      }
    }
    if (head == null || i == 0)
      lines[i] = line.replace(/^[\s\*]*/, "")
    else if (line.length < head.length)
      lines[i] = ""
    else
      lines[i] = line.slice(head.length)
  }

  while (lines.length && !lines[lines.length - 1]) lines.pop()
  while (lines.length && !lines[0]) lines.shift()
  return lines.join("\n")
}

module.exports = function(text, filename, parse, callbacks) {
  var current = null, found = []

  var ast = acorn.parse(text, {
    ecmaVersion: 6,
    locations: true,
    sourceFile: {text: text, name: filename},
    sourceType: "module",
    onComment: function(block, text, start, end, startLoc, endLoc) {
      if (/^\s*(?:::|;;)/.test(text)) {
        var obj = {text: text.split("\n"), start: start, end: end, startLoc: startLoc, endLoc: endLoc}
        found.push(obj)
        if (!block) current = obj
      } else if (current && !block && current.endLoc.line == startLoc.line - 1) {
        current.text.push(text)
        current.end = end
        current.endLoc = endLoc
      } else {
        current = null
      }
    }
  })

  for (var i = 0; i < found.length; i++) {
    var comment = found[i]
    var stack = findNodeAfter(ast, comment.end, callbacks)
    var top = stack && stack[stack.length - 1]
    if (!top || !/^(?:[;{},\s]|\/\/.*|\/\*.*?\*\/)*$/.test(text.slice(top.end, comment.start)))
      throw new SyntaxError("Misplaced documentation block at " + filename + ":" + comment.startLoc.line)
    callbacks[top.type](top, parse(top, strip(comment.text)), stack)
  }
}

function Found() {}

function findNodeAfter(ast, pos, types) {
  var stack = []
  function c(node, _, override) {
    if (node.end < pos) return
    if (node.start >= pos && types[node.type]) {
      stack.push(node)
      throw new Found
    }
    if (!override) stack.push(node)
    walk.base[override || node.type](node, null, c)
    if (!override) stack.pop()
  }
  try {
    c(ast)
  } catch (e) {
    if (e instanceof Found) return stack
    throw e
  }
}
