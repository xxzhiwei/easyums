const { client } = require("../config/redisHelper");

// client.set("sessionid", "123", async (err, result) => {
//     if (err) {
//         return console.log(err);
//     }
//     console.log(result);
//     const sessionid = await client.get("sessionid");
// });

(async () => {
    const resp = await client.set("sessionid", "123", "EX", 60);
    console.log(resp);
})();
