// Vercel serverless entry. The Nest app is compiled with tsc first, so
// decorator metadata required by Nest's DI is present at runtime.
module.exports = require("../dist/serverless.js").default;
