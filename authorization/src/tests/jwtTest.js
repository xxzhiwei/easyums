const jwtUtil = require("../util/tokenUtil");

const token = jwtUtil.generateWithDefault({ scope: '1 2 3', a: '12312312321312312312321', b: 'sdfsfxxxxxxxxxxxx' });
console.log(token);
console.log(token.length);

// verification fails if null is returned.
const decoded = jwtUtil.verify(token);
console.log(decoded);