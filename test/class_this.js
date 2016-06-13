// ::- A Foo
class Foo {
  // :: (number)
  constructor(a) {
    // :: number
    // The a property
    this.a = a
  }
}

// :: ()
Foo.prototype.doStuff = function() {
  // :: bool
  // The b property
  this.b = true
}
