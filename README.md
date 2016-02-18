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
{
  "plus": {
    "type": "Function",
    "params": [
      {
        "type": "number",
        "name": "a"
      },
      {
        "type": "number",
        "default": "2",
        "optional": true,
        "name": "b"
      }
    ],
    "returns": { "type": "number" },
    "description": "Add two numbers",
    "kind": "function",
    "exported": true
  }
}
```

The idea is to then feed this into a system that massages it into
actual HTML or Markdown or whatever documentation files.

A getdocs doc comment starts at either a type declarations (a comment
line starting with `::`) or a start marker `;;`. It can be either a
block comment or a sequence of line comments.

Such a doc comment applies to the next program element after it. That
element should be something with a name, like a variable, function, or
class declaration, or an assignment that can be statically resolved.

The documented items found in the files passed to getdocs will be
returned as part of a big JSON object. Nesting is only applied for
class and object properties, where the properties are moved under the
`properties` object of the item they are part of. _A single namespace
is assumed for the documented identifiers in the group of files._

## Type syntax

A type can be:

 * A JavaScript identifier, optionally followed by any number of
   properties, which are a dot character followed by a JavaScript
   identifier. A type name can be followed by a list of content types,
   between angle brackets, as in `Object<string>`.

 * An array type, which is a type wrapped in `[` and `]`. `[x]` is
   equivalent to `Array<x>`.

 * A function type, which is written as a parenthesized list of
   argument types. Each argument type may optionally be prefixed with
   an argument name, which is an identifier followed by a colon. When
   an argument is prefixed by the string `...`, it is marked as a
   `rest` argument. After the closing parenthesis, an optional return
   type may appear after an arrow, written either `→` or `->`.

 * A nullable type, written as a question mark followed by a type.

 * An unspecified or “any” type, written as an asterisk `*`.

 * An object type, written as a list of properties wrapped in `{` and
   `}` braces. Each property must start with an identifier, followed
   by a comma, followed by a type.

 * A string literal, enclosed by double quotes.

Here are some examples of types:

 * `Math.pow`: `(base: number, exponent: number) → number`

 * `Element.insertBefore`: `(newNode: Node, before: ?Node) → Node`

 * `console.log`: `(...data: *)`

 * A pair of coordinates: `{x: number, y: number}`

 * An array of strings: `[string]`

 * An array of `CommandSpec`s or the string "schema": `union<[CommandSpec], "schema">`

## Tags

It is possible to add tags to a documented item. These are words
prefixed with a `#` character, appearing at the start of the comment —
that is, immediately after the `;;` for a type-less comment, or
immediately after the type for a typed one.

A tag like `#deprecated`, for example, will result in a `$deprecated:
"true"` property on the given item. The property is named by
prepending the tag's name with a dollar sign.

You can give tags an explicit value other than `"true"` by writing an
`=` character followed either by a word (a sequence of characters
without whitespace) or a quoted JavaScript-style string. For example
`#chapter=selection` or `#added="2.1.0"`.

These tags have a special meaning that is interpreted by getdocs:

 * **path**: Prevents the comment from being associated with the
   program element after it, and puts it in the namespace under the
   given path instead, which should be something like `name` or
   `Foo.prototype.methodName`. You can also separate elements with a
   `#` to indicate a direct property (rather than going through
   `.properties`) in the output—for example `Foo#constructor` to set
   the constructor property of a class.

 * **kind**: Explicitly sets the kind of this item. Does not get a
   dollar sign prefix.

 * **forward**: Can be used to make the properties or methods of a
   class or object appear in another class or object. A typical use
   case is moving documentation from a private subclass into a public
   abstract class. A tag like `#forward=Foo` will cause the properties
   of the annotated thing to appear in the documentation for the thing
   named `Foo` instead. Note that other information included in the
   doc comments that has the `forward` tag will be ignored.

## Output JSON

The returned object maps item names to item descriptions. The
following properties can appear in a description for a documented
item:

 * **description**: The doc comment for the item.

 * **kind**: The kind of program element that is documented. May be
   `function`, `var`, `let`, `const`, `class`, `constructor`,
   `method`, `getter`, or `setter`.

 * **loc**: A `{line, column, file}` object pointing at the start of the item.

 * **exported**: Set if the item is exported.

 * **constructor**: For classes with a documented constructor, this
   points at the constructor function.

 * **extends**: Only applies for classes. Holds the name of the
   superclass.

 * **instanceProperties**: For classes, this holds properties and
   methods that appear on instances (and on the prototype).

In addition, they may have these properties, which can also appear on
nested types:

 * **type**: The name of the type. Instances of classes should use the
   (capitalized) class name. Builtin types will have names like
   `Array` or `Function`. Getdocs does not prescribe a naming of
   builtin types, but for consistency I recommend you use `number`,
   `string`, and `bool`.

 * **params**: For function types, this holds an array of parameter
   types. Parameter types can have these additional properties:

     * **name**: The name of the parameter.

     * **rest**: Set when this is a rest parameter.

     * **default**: The default value of the parameter.

 * **returns**: For function types, this holds the type that is
   returned.

 * **properties**: An object mapping property names to types.

 * **content**: For array types or named types with content (angle
   brackets) specification, this holds an array of content types.

 * **optional**: Set for nullable types.
