const path = require('path');
const fs = require("fs");
const { parse } = require("ini");
// console.log(__dirname);
// console.log(process.cwd());
// console.log(path.resolve(process.cwd()));
const content = fs.readFileSync(path.resolve(process.cwd(), "../secrets/miniprogram-config.ini"), { encoding: 'utf-8' });
console.log(content);
// const miniprogramConfig = parse();