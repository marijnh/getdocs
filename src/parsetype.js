module.exports = function(string, start, loc) {
  var input = new Input(string, start, loc)
  var result = parse(input)
  input.skip()
  return {type: result, end: input.pos}
}

function isSpace(ch) {
  return (ch < 14 && ch > 8) || ch === 32 || ch === 160;
}

function Input(string, start, loc) {
  this.str = string
  this.pos = start
  this.loc = loc
  this.skip()
}

Input.prototype = {
  skip: function() {
    while (this.pos < this.str.length && isSpace(this.str.charCodeAt(this.pos))) ++this.pos
  },

  atEnd: function() {
    return this.pos == this.str.length
  },

  eat: function(ch) {
    if (this.str.charCodeAt(this.pos) == ch.charCodeAt(0)) {
      this.pos++
      this.skip()
      return true
    }
  },

  match: function(re) {
    var match = re.exec(this.str.slice(this.pos))
    if (match) {
      this.pos += match[0].length
      this.skip()
      return match
    }
  },

  error: function(message) {
    throw new SyntaxError(message + " for " + this.loc.source.name + ":" + this.loc.start.line)
  }
}

function parse(input) {
  if (input.eat("?")) {
    var inner = parse(input)
    inner.optional = true
    return inner
  } else if (input.eat("*")) {
    return {type: "any"}
  } else if (input.eat("(")) {
    var type = {type: "Function", params: []}
    while (!input.eat(")")) {
      if (type.params.length && !input.eat(",")) input.error("Missing comma or closing paren")
      var rest = input.match(/^\.\.\./)
      var name = input.match(/^([\w$]+)(\??)\s*:/)
      var param = parse(input)
      if (rest) param.rest = true
      if (name) param.name = name[1]
      if (name && name[2]) param.optional = true
      type.params.push(param)
    }
    if (input.match(/→|->/))
      type.returns = parse(input)
    return type
  } else if (input.eat("[")) {
    var type = {type: "Array", content: parse(input)}
    if (!input.eat("]")) input.error("Unclosed array type")
    return type
  } else if (input.eat("{")) {
    var type = {type: "Object", properties: {}}, first = true
    while (!input.eat("}")) {
      if (!first && !input.eat(",")) input.error("Missing comma or closing brace")
      first = false
      var name = input.match(/^([\w$]+)\s*:/)
      if (!name) input.error("Malformed object type")
      type.properties[name[1]] = parse(input)
    }
    return type
  } else {
    var name = input.match(/^[\w$]+(?:\.[\w$]+)*/)
    if (!name) input.error("Unexpected syntax: " + input.str.slice(input.pos, input.pos + 5))
    var type = {type: name[0]}
    if (input.eat("<")) {
      type.content = []
      while (!input.eat(">")) {
        if (type.content.length && !input.eat(",")) input.error("Missing comma or closing angle bracket")
        type.content.push(parse(input))
      }
    }
    return type
  }
}
