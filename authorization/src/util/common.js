const querystring = require('querystring');
const crypto = require("crypto");

// 规定客户端秘钥进行编码后，在header的Authorization中传输；
// 格式为Header.Authorization = Basic base64;
function decodeClientCredentials(authorization) {
    const clientCredentials = Buffer.from(authorization.slice('Basic '.length), 'base64').toString().split(':');
    const clientId = querystring.unescape(clientCredentials[0]);
    const clientSecret = querystring.unescape(clientCredentials[1]);
    return { id: clientId, secret: clientSecret };
    // const clientCredentials = Buffer.from(authorization.slice('Basic '.length), 'base64').toString();
    // const clientSecret = querystring.unescape(clientCredentials);
    // return { secret: clientSecret };
}

function encodeWithMd5(str) {
    return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * 从表单属性中获取权限范围；
 * 权限范围在表单中，以"scope_"开头；
 * 从对象中读取以scope_开头的属性，并裁剪&返回；
 * （注意，被勾选的权限，其值为on；未勾选的不会被提交）
 * @param {Object} scopes
 * @returns {Array<String>}
 */
function getScopesFromBody(scopes) {
    const _scopes = [];
    const prefix = "scope_";
    for (const key in scopes) {
        if (key.startsWith(prefix)) {
            _scopes.push(key.replace(prefix, ""));
        }
    }
    return _scopes;
}

module.exports = {
    decodeClientCredentials, encodeWithMd5, getScopesFromBody
};
