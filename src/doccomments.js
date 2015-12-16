var acorn = require("acorn/dist/acorn")
var walk = require("acorn/dist/walk")

var parseType = require("./parsetype")

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

exports.parse = function(text, filename) {
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
    var comment = found[i], loc = comment.startLoc
    loc.file = filename
    comment.data = parseComment(strip(comment.text), comment.startLoc)
  }
  return {ast: ast, comments: found}
}

function Found() {}

exports.findNodeAfter = function(ast, pos, types) {
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

var directTags = {kind: true}

function parseComment(text, loc) {
  var match = /^\s*(;;|::)\s*/.exec(text)
  var data, pos = match[0].length
  if (match[1] == "::") {
    var parsed = parseType(text, pos, loc)
    data = parsed.type
    pos = parsed.end
  } else {
    data = Object.create(null)
    data.loc = loc
  }
  text = text.slice(pos)
  while (match = /^\s*#([\w$]+)(?:=([^"]\S*|"(?:[^"\\]|\\.)*"))?\s*/.exec(text)) {
    text = text.slice(match[0].length)
    var value = match[2] || "true"
    if (value.charAt(0) == '"') value = JSON.parse(value)
    if (directTags.hasOwnProperty(match[1])) {
      data[match[1]] = value
    } else {
      ;(data.tags || (data.tags = Object.create(null)))[match[1]] = value
    }
  }
  if (/\S/.test(text)) data.description = text
  return data
}
