# Getdocs

Getdocs is like JSDoc or documentation.js, running over ES6 code to
extract information and inline documentation in order to generate
docs, but without all the @s. It takes source files and outputs JSON.

For example, if you have this file, `foo.js`:

```javascript
// :: (number, number) → number
// Add two numbers
export function plus(a, b = 2) {
  return a + b
}
```

You can say `getdocs foo.js` to get this JSON:

```json
[
  {
    "name": "plus",
    "kind": "function",
    "location": {
      "file": "foo.js",
      "line": 3,
      "column": 0
    },
    "description": "Add two numbers",
    "type": {
      "type": "function",
      "arguments": [
        {
          "name": "a",
          "type: "number"
        },
        {
          "name": "b",
          "type": "number",
          "optional": true,
          "default": "2"
        }
      ]
    }
  }
]
```

The idea is to then feed this into a system that massages it into
actual HTML or Markdown or whatever documentation files.

A getdocs doc comment starts at either a type declarations (a comment
line starting with `::`) or a start marker `:-`. It goes on until the
next non-comment element, or until the next doc comment.

A doc comment applies to the next program item after it. That item
should be something with a name, like a variable, function, or class
declaration, or an assignment to a property.

The documented items found in the files passed to getdocs will be
returned as part of a big JSON array. Nesting is only applied for
class and object properties, where the properties are moved under the
`properties` array of the item they are part of.

Getdocs does not try to understand complicated ways of creating
classes yet (using object-manipulating functions and such). It also
assumes a single namespace of items among the files you pass it.
