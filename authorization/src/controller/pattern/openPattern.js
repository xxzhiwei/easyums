// 以模块区分
const { responseTypes, grantTypes } = require("../../constants/oauth");
// const clientService = require("../../service/clientService");
// const { checkRequest, getRequest } = require("../../util/tempStoreForRequest");
const { AGREE, REJECT } = require("../../constants/general");
// const { decodeClientCredentials } = require("../../util/common");
const config = require("../../config/appConfig");

// 当然，不以这种方式来校验也是可以的，只是说使用这种校验形式可以使得业务代码更集中;
// 重新考虑了一下，虽然js可以轻易做到在任何地方做校验，但其他语言可能不行，所以有些校验应该放在业务层，这里只校验一些静态规则；
const patternsForAuthorize = [{
    position: "query",
    rules: [{
        name: "response_type",
        validator: (value, _this, ctx) => {
            let errors = [];
            if (!value) {
                errors.push(_this.name + "不能为空");
            }
            else {
                let matched = false;
                for (let key in responseTypes) {
                    if (value === responseTypes[key]) {
                        matched = true;
                        break;
                    }
                }
                if (!matched) {
                    errors.push(_this.name + "格式错误");
                }
            }
            return errors;
        }
    }, {
        name: "client_id",
        required: true,
        // validator: async (value, _this, ctx) => {
        //     let errors = [];
        //     if (!value) {
        //         errors.push(_this.name + "不能为空");
        //     }
        //     else {
        //         const client = await clientService.getClientById(+value);
        //         ctx.request.client = client;
        //         if (!client) {
        //             errors.push("未知的" + _this.name);
        //         }
        //     }
        //     return errors;
        // }
    }, {
        name: "scope",
        validator(value, _this, ctx) {

        }
    }]
}];

const patternsForApprove = [{
    position: "body",
    rules: [{
        name: "uuid",
        required: true,
        // validator(value, _this, ctx) {
        //     let errors = [];
        //     if (!value) {
        //         errors.push(this.name + "不能为空");
        //     }
        //     else {
        //         if (!checkRequest(value)) {
        //             errors.push(this.name + "不存在");
        //         }
        //     }
        //     return errors;
        // }
    }, {
        name: "action",
        validator(value, _this, ctx) {
            let errors = [];
            if (!value) {
                errors.push(this.name + "不能为空");
            }
            else {
                if (value !== AGREE && value !== REJECT) {
                    errors.push(this.name + "格式错误")
                }
            }
            return errors;
        }
    }]
}];

const patternsForToken = [{
    position: "body",
    rules: [{
        name: "grant_type",
        required: true,
        validator(value, _this, ctx) {
            if (value) {
                let matched = false;
                for (const key in grantTypes) {
                    if (value === grantTypes[key]) {
                        matched = true;
                        break;
                    }
                }
                if (!matched) {
                    return this.name + "格式错误";
                }
            }
        }
    }, {
        name: "code",
        required: true,
        // validator(value, _this, ctx) {
        //     const errors = [];
        //     if (!value) {
        //         errors.push(this.name + "不能为空");
        //     }
        //     else {
        //         const preRequest = getRequest(value, false);
        //         if (preRequest == null) {
        //             errors.push("未知的" + this.name);
        //         }
        //         else {
        //             ctx.request.client = preRequest.client;
        //         }
        //     }
        //     return errors;
        // }
    }, {
        name: "redirect_uri",
        required: true,
        // validator(value, _this, ctx) {
        //     let errors = [];
        //     if (!value) {
        //         errors.push(this.name + "不能为空");
        //     }
        //     else {
        //         const client = ctx.request.client;
        //         if (client) {
        //             if (!client.redirect_uris.includes(value)) {
        //                 errors.push("不匹配的" + this.name);
        //             }
        //         }
        //     }
        //     if (errors.length) {
        //         throw new Error(errors.join(";"));
        //     }
        // }
    }, {
        name: "client_id",
        required: true,
        // validator(value, _this, ctx) {
        //     let errors = [];
        //     if (!value) {
        //         errors.push(this.name + "不能为空");
        //     }
        //     else {
        //         value = +value;
        //         const client = ctx.request.client;
        //         if (client) {
        //             if (client.id !== value) {
        //                 errors.push("不匹配的" + this.name);
        //             }
        //         }
        //     }
        //     if (errors.length) {
        //         throw new Error(errors.join(";"));
        //     }
        // }
    }]
}, {
    position: "header",
    rules: [{
        name: "authorization",
        required: true,
        // validator(value, _this, ctx) {
        //     let errors = [];
        //     if (!value) {
        //         errors.push(this.name + "不能为空");
        //     }
        //     else {
        //         const { secret } = decodeClientCredentials(value);
        //         const client = ctx.request.client;
        //         if (client && client.secret !== secret) {
        //             errors.push("客户端验证失败");
        //         }
        //     }
        //     if (errors.length) {
        //         throw new Error(errors.join(";"));
        //     }
        // }
    }]
}];

module.exports = {
    patternsForAuthorize, patternsForApprove, patternsForToken
}
