// jest stub for LESS/CSS side-effect imports — visual.ts imports its
// stylesheet at the top of the module; that import has zero runtime
// value in tests, so we resolve it to an empty object.
module.exports = {};
