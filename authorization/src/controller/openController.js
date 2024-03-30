const Router = require('koa-router');
const { v4: uuidV4 } = require("uuid");

const { ACT_1, ACT_2, ID_TOKEN, REDIS_OK } = require("../constants/general");
const { joinUrl } = require("../util/urlUtil");
const tokenService = require("../service/tokenService");
const tokenUtil = require("../util/tokenUtil");
const { errors: oauthErrors, grantTypes, responseTypes } = require("../constants/oauth");
const { patternsForAuthorize, patternsForApprove, patternsForToken, patternsForLogin } = require("./pattern/openPattern");
const paramChecker = require("../middleware/paramChecker");
const { OauthException, CustomException, ClientException } = require("../exception");
const clientService = require("../service/clientService");
const { decodeClientCredentials, getScopesFromBody } = require("../util/common");
const { codeStore, requestStore } = require("../store");
const config = require("../config/appConfig");
const userService = require("../service/userService");
const { client: redisClient } = require("../config/redisHelper");

const router = new Router({
    prefix: "/oauth2"
});

router.get("/", async (ctx, next) => {
    ctx.body = "easyums oauth";
});

// 登陆成功后，会记录在redis中（七天）；
// 为防止使用过期缓存，在修改用户信息时，或许应该把缓存修改？先不管
router.post("/login", paramChecker(patternsForLogin), async (ctx) => {
    const { username, password, uuid } = ctx.request.body;
    const preReq = requestStore.get(uuid);
    if (!preReq) {
        throw new CustomException({ code: oauthErrors.UNKNOWN_REQUEST });
    }
    const user = await userService.login(username, password);
    ctx.session.user = user;
    const sessionToken = uuidV4();
    const seconds = 60 * 60 * 24 * 7;
    const date = new Date();
    const milliseconds = seconds * 1000;
    date.setTime(date.getTime() + milliseconds);
    ctx.cookies.set('session_token', sessionToken, {
        maxAge: milliseconds,
        expires: date
    });
    const resp = await redisClient.set(sessionToken, JSON.stringify(user), "EX", seconds);
    if (REDIS_OK !== resp) {
        throw new CustomException();
    }
    const query = { ...preReq.query };
    query.redirect_uri = encodeURIComponent(query.redirect_uri);
    // 登陆后，跳转回授权页面（携带参数）
    ctx.redirect(joinUrl("/oauth2/authorize", query));
});

router.get("/authorize", paramChecker(patternsForAuthorize, (errors, ctx) => {
    if (ctx.request.query.redirect_uri) {
        // 如果是当前请求，会自动解码
        // redirectUri = decodeURIComponent(redirectUri);
        throw new OauthException({
            code: oauthErrors.INVALID_REQUEST, message: errors.join(";"),
            redirectUrl: decodeURIComponent(ctx.request.query.redirect_uri)
        });
    }
}), async (ctx, next) => {
    const req = ctx.request;
    const { client_id: clientId, redirect_uri: redirectUri, scope } = req.query;
    const client = await clientService.getClientById(clientId);
    req.redirectUri = decodeURIComponent(redirectUri);
    if (!client) {
        throw new OauthException({
            code: oauthErrors.UNKNOWN_CLIENT,
            redirectUrl: req.redirectUri
        });
    }
    // 在session中获取user，如果已经过期时，从redis中获取
    let user = ctx.session.user;
    if (!user) {
        const sessionToken = ctx.cookies.get("session_token");
        if (sessionToken) {
            const userStr = redisClient.get(sessionToken);
            if (userStr) {
                user = JSON.parse(userStr);
            }
        }
    }
    const uuid = uuidV4();
    req.client = client;
    requestStore.save(uuid, req);
    const scopes = config.oauth.scopes;
    let askedScopes = req._scopes;
    if (!askedScopes) {
        askedScopes = scope.trim().split(" ");
    }
    await ctx.render('approval', {
        client, uuid, scopes, askedScopes, user
    });
});

// 授权；
// 用户可在授权页面上进行操作；
router.post("/approve", paramChecker(patternsForApprove, null), async (ctx, next) => {
    const { action, uuid, ...scopes } = ctx.request.body;
    const _scopes = getScopesFromBody(scopes); // 即真正授权范围
    const preReq = requestStore.get(uuid);
    if (!preReq) {
        throw new CustomException({ code: oauthErrors.UNKNOWN_REQUEST });
    }
    let { response_type: responseType, state } = preReq.query;
    const redirectUri = preReq.redirectUri;
    const queries = {};
    // 同意授权
    if (action === ACT_1) {
        // 授权码模式
        if (responseType === responseTypes.CODE) {
            const code = uuidV4().replaceAll("-", "");
            queries['code'] = code;
            if (state) {
                queries['state'] = state;
            }
            const client = preReq.client;
            const req = ctx.request;
            req.client = client;
            req.scopes = _scopes;
            req._containedOpenid = preReq._containedOpenid;
            req.user = ctx.session.user;
            codeStore.save(code, req);
        }
    }
    // 不同意这里算是操作成功的流程；怎么判断是应该渲染还是重定向？还是说，一律把错误返回？
    else if (action === ACT_2) {
        queries['error'] = oauthErrors.ACCESS_DENIED;
    }
    const redirectUrl = joinUrl(redirectUri, queries);
    await ctx.redirect(redirectUrl);
});

// 兑换token；
router.post("/token", paramChecker(patternsForToken, (errors, ctx) => {
    throw new ClientException({ message: errors.join(";") });
}), async (ctx, next) => {
    const req = ctx.request;
    const { grant_type: grantType, code, client_id: clientId, redirect_uri: redirectUri } = req.body;
    const preReq = codeStore.get(code);
    // 校验code
    if (!preReq) {
        throw new ClientException({ code: oauthErrors.INVALID_CODE });
    }
    const client = preReq.client;
    const { secret, id } = decodeClientCredentials(req.headers['authorization']);
    // 校验客户端
    if ((+id !== clientId) || (client.id !== clientId) || (client.secret !== secret)) {
        throw new ClientException({ code: oauthErrors.INVALID_CLIENT });
    }
    // 校验重定向地址
    if (!client.redirect_uris.includes(redirectUri)) {
        throw new ClientException({ code: oauthErrors.INVALID_REDIRECT_URI });
    }

    const user = preReq.user;

    let respData;
    const scope = preReq.scopes.join(" "); // 将数组拆分为字符串
    if (grantType === grantTypes.AUTHORIZATION_TYPE) {
        const tokenPayload = { clientId, userId: user.id };
        respData = {
            error: '',
            payload: {
                access_token: tokenUtil.generateToken(tokenPayload),
                refresh_token: tokenUtil.generateRefreshToken(tokenPayload),
                token_type: "bearer"
            }
        };

        // 在校验时添加的属性
        if (preReq._containedOpenid) {
            const idTokenPayload = {
                sub: user.id,
                aud: clientId,
                user
            };
            respData.payload[ID_TOKEN] = tokenUtil.generateIdToken(idTokenPayload);
        }
    }

    try {
        // 保证每个用户仅有一个token记录
        await tokenService.delTokensByUserId(user.id);
        const tokenEntity = {
            accessToken: respData.payload.access_token,
            refreshToken: respData.payload.refresh_token,
            clientId, userId: user.id, scope: scope
        };
        await tokenService.save(tokenEntity);
    } catch (error) {
        console.log(error);
        throw new CustomException();
    }
    return ctx.body = respData;
});

module.exports = router;
