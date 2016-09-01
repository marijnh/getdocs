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
  if (head != null) {
    var startIndent = /^\s*/.exec(lines[0])[0]
    var trailing = /\s*$/.exec(head)[0]
    var extra = trailing.length - startIndent.length
    if (extra > 0) head = head.slice(0, head.length - extra)
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

exports.parse = function(text, options) {
  var current = null, found = [], filename = options.filename

  var ast = acorn.parse(text, {
    ecmaVersion: 6,
    locations: true,
    sourceFile: {text: text, name: filename},
    sourceType: "module",
    onComment: function(block, text, start, end, startLoc, endLoc) {
      if (current && !block && current.endLoc.line == startLoc.line - 1) {
        current.text.push(text)
        current.end = end
        current.endLoc = endLoc
      } else if (/^\s*[\w\.$]*::/.test(text)) {
        var obj = {text: text.split("\n"), start: start, end: end, startLoc: startLoc, endLoc: endLoc}
        found.push(obj)
        if (!block) current = obj
      } else {
        current = null
      }
    }
  })

  for (var i = 0; i < found.length; i++) {
    var comment = found[i], loc = comment.startLoc
    loc.file = filename
    comment.parsed = parseNestedComments(strip(comment.text), comment.startLoc)
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

exports.findNodeAround = function(ast, pos, types) {
  var stack = [], found
  function c(node, _, override) {
    if (node.end <= pos || node.start >= pos) return
    if (!override) stack.push(node)
    walk.base[override || node.type](node, null, c)
    if (types[node.type] && !found) found = stack.slice()
    if (!override) stack.pop()
  }
  c(ast)
  return found || stack
}

function parseComment(text, loc) {
  var match = /^\s*([\w\.$]+)?::\s*(-\s*)?/.exec(text), data, end = match[0].length, name = match[1]
  if (match[2]) {
    data = Object.create(null)
    data.loc = loc
  } else {
    var parsed = parseType(text, match[0].length, loc)
    data = parsed.type
    end = parsed.end
  }

  text = text.slice(end)
  while (match = /^\s*#([\w$]+)(?:=([^"]\S*|"(?:[^"\\]|\\.)*"))?\s*/.exec(text)) {
    text = text.slice(match[0].length)
    var value = match[2] || "true"
    if (value.charAt(0) == '"') value = JSON.parse(value)
    data["$" + match[1]] = value
  }

  if (/\S/.test(text)) data.description = text
  return {data: data, name: name, subcomments: []}
}

function parseNestedComments(text, loc) {
  var line = 0, context = [], top, nextIndent = /^\s*/.exec(text)[0].length
  for (;;) {
    var next = /\n( *)[\w\.$]*::/.exec(text)
    var current = next ? text.slice(0, next.index) : text
    var parsed = parseComment(current, line ? {line: loc.line + line, column: loc.column, file: loc.file} : loc)
    if (!top) {
      top = parsed
    } else {
      if (!parsed.name)
        throw new SyntaxError("Sub-comment without name at " + loc.file + ":" + (loc.line + line))
      while (context[context.length - 1].indent >= nextIndent) {
        context.pop()
        if (!context.length)
          throw new SyntaxError("Invalid indentation for sub-field at " + loc.file + ":" + (loc.line + line))
      }
      context[context.length - 1].comment.subcomments.push(parsed)
    }
    context.push({indent: nextIndent, comment: parsed})

    if (!next) break
    line += current.split("\n").length + 1
    text = text.slice(current.length + 1)
    nextIndent = next[1].length
  }
  return top
}
