// 认证相关
const Router = require('koa-router');

const { ACT_1, ACT_2, ID_TOKEN, REDIS_OK } = require("../../../common/src/constants/general");
const { joinUrl } = require("../../../common/src/util/urlUtil");
const tokenService = require("../service/tokenService");
const tokenUtil = require("../util/tokenGenerator");
const { errors: oauthErrors, grantTypes, responseTypes } = require("../constants/oauth");
const patterns = require("./pattern/patternsForAuthorizationController");
const paramChecker = require("../../../common/src/middleware/paramChecker");
const { OauthException, CustomException, ClientException } = require("../../../common/src/exception");
const clientService = require("../service/clientService");
const { decodeClientCredentials, getScopesFromBody, generateUuid, encodeWithMd5 } = require("../../../common/src/util/common");
const { codeStore, requestStore } = require("../store");
const config = require("../config/appConfig");
const userService = require("../service/userService");
const { client: redisClient } = require("../config/redisHelper");
const { buildUserinfo } = require("../../../common/src/util/oidcUtil");
const emailService = require("../service/emailService");

const router = new Router({
    prefix: "/oauth2"
});

router.get("/", async (ctx) => {
    const { from } = ctx.request.query;
    let title = "WELCOME";
    let message = ":D you're here.";
    if (from === "logout") {
        title = "BYE!";
        message = "hope to see you again.";
    }
    await ctx.render("index", { title, message });
});

router.get("/register", async (ctx) => {
    await ctx.render("register");
});

router.get("/logout", async (ctx) => {
    const user = ctx.session.user;
    if (user.id) {
        console.log("登出用户：%s", ctx.session.user.id);
        ctx.session = {};
    }
    const sessionToken = ctx.cookies.get("session_token");
    if (sessionToken) {
        console.log("删除sessionToken：" + sessionToken);
        const result = await redisClient.del(sessionToken);
        console.log(result);
        ctx.cookies.set('session_token', "", {
            maxAge: 0
        });
    }
    let path = "/oauth2?from=logout";
    await ctx.redirect(path);
});

router.post("/register", paramChecker(patterns.register), async (ctx) => {
    const formData = ctx.request.body;
    // 核对验证码；不使用接口，直接操作redis也是可以的；
    await emailService.verify(formData.code, formData.email);
    if (await userService.register(formData)) {
        ctx.body = { error: '', message: '注册成功' };
    }
    else {
        throw new CustomException();
    }
});

// 登陆成功后，会记录在redis中（七天）；
// 为防止使用过期缓存，在修改用户信息时，或许应该把缓存修改？先不管
router.post("/login", paramChecker(patterns.login), async (ctx) => {
    let { username, password, query } = ctx.request.body;
    const user = await userService.login(username, password);
    ctx.session.user = user;
    const sessionToken = generateUuid();
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
    query = JSON.parse(query);
    query.redirect_uri = encodeURIComponent(query.redirect_uri);
    // 登陆后，跳转回授权页面（携带参数）
    ctx.redirect(joinUrl("/oauth2/authorize", query));
});

router.get("/authorize", paramChecker(patterns.authorize, {
    errorHandler: (errors, ctx) => {
        if (ctx.request.query.redirect_uri) {
            throw new OauthException({
                code: oauthErrors.INVALID_REQUEST, message: errors.join(";"),
                redirectUrl: decodeURIComponent(ctx.request.query.redirect_uri)
            });
        }
    },
    errorCode: oauthErrors.INVALID_REQUEST
}), async (ctx, next) => {
    const req = ctx.request;
    const { client_id: clientId, redirect_uri: redirectUri, scope } = req.query;
    // 在session中获取user；
    // 如果已经过期时，从redis中获取，并赋予session（相当于重新登陆）；
    let user = ctx.session.user;
    if (!user) {
        const sessionToken = ctx.cookies.get("session_token");
        if (sessionToken) {
            const userStr = await redisClient.get(sessionToken);
            if (userStr) {
                user = JSON.parse(userStr);
                ctx.session.user = user;
            }
        }
    }
    let tempData;
    // 用户没登录时，不需要记录以下数据
    if (user) {
        const client = await clientService.getClientById(clientId);
        req.redirectUri = decodeURIComponent(redirectUri);
        if (!client) {
            throw new OauthException({
                code: oauthErrors.UNKNOWN_CLIENT,
                redirectUrl: req.redirectUri
            });
        }
        const uuid = generateUuid();
        req.client = client;
        requestStore.save(uuid, req);
        const scopes = config.oauth.scopes;
        let askedScopes = req._scopes;
        if (!askedScopes) {
            askedScopes = scope.trim().split(" ");
        }
        tempData = {
            oauthClient: client, uuid, scopes, askedScopes, user
        };
    }
    else {
        tempData = { user: null, query: JSON.stringify(req.query) };
    }
    await ctx.render('approval', tempData);
});

// 授权；
// 用户可在授权页面上进行操作；
router.post("/approve", paramChecker(patterns.approve), async (ctx, next) => {
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
            const code = generateUuid();
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
router.post("/token", paramChecker(patterns.token, {
    errorHandler: (errors, ctx) => {
        throw new ClientException({ code: oauthErrors.INVALID_REQUEST, message: errors.join(";") });
    },
    errorCode: oauthErrors.INVALID_REQUEST
}), async (ctx, next) => {
    const req = ctx.request;
    let { grant_type: grantType, code, client_id: clientId, redirect_uri: redirectUri } = req.body
    clientId = +clientId;
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
    const tokenId = generateUuid();
    if (grantType === grantTypes.AUTHORIZATION_TYPE) {
        const tokenPayload = { clientId, userId: user.id, tokenId: tokenId };
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
                client_id: clientId,
                openid: encodeWithMd5(clientId + "@" + user.id),
                userinfo: buildUserinfo(preReq.scopes, user)
            };
            respData.payload[ID_TOKEN] = tokenUtil.generateIdToken(idTokenPayload);
        }
    }

    try {
        // 保证每个用户仅有一个token记录
        const tokens = await tokenService.getTokensByUserId(user.id);
        if (tokens.length) {
            console.log("删除数据库中的token：");
            const _token = tokens[0];
            const results = await Promise.all([tokenService.delToken(_token), redisClient.del(_token.id)])
                .catch(error => {
                    console.log(error);
                });
            console.log(results);
        }
        const tokenEntity = {
            id: tokenId,
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
