// :: (union<"a","b">, number, number) → number
// Returns a or b
function add(which, a, b) {
  return which === "a" ? a : b
}
