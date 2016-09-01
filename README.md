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
    "exported": true
  }
}
```

The idea is to then feed this into a system (can be a simple set of
templates) that massages it into actual human-readable documention
files.

A getdocs doc comment starts with a double colon, optionally prefixed
with a name (`foo::`) and followed by a type. It can be either a block
comment or a continuous sequence of line comments. When you don't want
to specify a type, for example because the type can be inferred from
the code (as with a class declaration), you can write a single dash
after the colons, instead of a type.

When no name is given, such a doc comment applies to the next program
element after it. That element should be something with a name, like a
variable, function, or class declaration, or an assignment that can be
statically resolved.

The documented items found in the files passed to getdocs will be
returned as part of a big JSON object. Nesting is only applied for
class and object properties, where the properties are moved under the
`properties` object of the item they are part of. _A single namespace
is assumed for the documented identifiers in the group of files._

Inside a doc comment, properties of the thing being defined can be
added by writing nested, indented doc comments. For example:

```
// Plugin:: interface
//
// Objects conforming to the plugin interface can be plugged into a
// Foo
//
//   mount:: (Foo) → bool
//   Mount the plugin in this Foo. The return value indicates whether
//   the mount succeeded.
//
//   unmount:: (Foo)
//   Unmount the plugin from a Foo.
```

Further nesting below such a property (by adding more indentation) is
supported.

## Type syntax

A type can be:

 * A JavaScript identifier, optionally followed by any number of
   properties, which are a dot character followed by a JavaScript
   identifier. A type name can be followed by a list of type
   parameters, between angle brackets, as in `Object<string>` (an
   object whose properties hold string values).

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
   by a colon, followed by a type.

 * A string literal, enclosed by double quotes, or a number literal.

Here are some examples of types:

 * `Math.pow`: `(base: number, exponent: number) → number`

 * `Element.insertBefore`: `(newNode: Node, before: ?Node) → Node`

 * `console.log`: `(...data: *)`

 * A pair of coordinates: `{x: number, y: number}`

 * An array of strings: `[string]`

 * An array of numbers or a string: `union<[number], string>` (what
   the name `union` means isn't something getdocs is aware of, but
   you could use it for union types, and maybe render it as `[number]
   | string` in your output).

## Tags

It is possible to add tags to a documented item. These are words
prefixed with a `#` character, appearing at the start of the comment —
that is, immediately after the type.

A tag like `#deprecated`, for example, will result in a `$deprecated:
"true"` property on the given item. The property is named by
prepending the tag's name with a dollar sign.

You can give tags an explicit value other than `"true"` by writing an
`=` character followed either by a word (a sequence of characters
without whitespace) or a quoted JavaScript-style string. For example
`#chapter=selection` or `#added="2.1.0"`.

The `#static` tag can be used to indicate that a given class member is
static (which is only necessary for doc comments that aren't tied to a
syntactic element in the code).

## Output JSON

The returned object maps item names to item descriptions. The
following properties can appear in a description for a documented
item:

 * **description**: The doc comment for the item.

 * **loc**: A `{line, column, file}` object pointing at the start of the item.

 * **exported**: Set if the item is exported using ES6 module syntax.

 * **constructor**: For classes with a documented constructor, this
   points at the constructor function.

 * **extends**: Only applies for classes. Holds the type of the
   superclass.

 * **staticProperties**: For classes, this holds properties and
   methods that appear directly on the constructor.

In addition, they may have these properties, which can also appear on
nested types:

 * **type**: The name of the type. Instances of classes should use the
   (capitalized) class name. Builtin types will have names like
   `Array` or `Function`. Getdocs does not prescribe a naming of
   primitive types, but for consistency I recommend you use `number`,
   `string`, and `bool`.

 * **properties**: An object mapping property names to types.

 * **params**: For function types, this holds an array of parameter
   types. Parameter types can have these additional properties:

     * **name**: The name of the parameter.

     * **rest**: Set when this is a rest parameter.

     * **default**: The default value of the parameter (as a raw
       source string).

 * **returns**: For function types, this holds the type that is
   returned.

 * **typeParams**: For array types or named types with parameters
   (angle bracket syntax), this holds an array of parameter types.

 * **optional**: Set for nullable types.

 * **id**: The path to this type. For a top-level variable `foo`
   this'll be `"foo"`, for the type of the property `bar` under `foo`,
   it'll be `"foo.bar"`, and so on.

## Interface

The module exports the following function:

**`gather`**`: (code: string, options: Object) → Object`

It takes a code file, extracts the docs, and returns an object
describing the documented items.

Options can have the following properties:

 * **`filename`**`: string` The filename of the given code. Required.

 * **`items`**`: ?Object` An existing items object to add the items
   found in the given code to.

 * **`onComment`**`: ?(block: bool, text: string, start: number, end:
   number, startPos: Object, endPos: Object)` Will be called for each
   comment in the code, if given.

**`parseType`**`: (input: string, start: number, loc: {file: string, line: number}) → {type: Object, end: number}`

Parse a type in getdocs syntax into its object representation. `start`
indicates where in the string the parsing should start. The returned
object tells you where the type ended.

Will throw a `SyntaxError` when the type isn't valid.

**`stripComment`**`: (comment: string) → string`

Strips leading indentation and asterisks (as in the common block
comment style where each line gets an asterisk) from a string.
