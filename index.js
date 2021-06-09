const optionTools = require('./tools')
const app = require("express")();
const httpServer = require("http").createServer(app);
const bodyParser = require('body-parser');

const fs = require('fs')
// 服务器 连接 币安
const api = require('./lib/binance'); //初始化api
const binanceWS = new api.BinanceWS(true); //创建服务
const binanceOptionWS = new api.BinanceOptionWS(true)
const binanceRest = new api.BinanceRest({
    secret: '',
    key: '',
    baseUrl: 'https://vapi.binance.com/'
})

app.all('*', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With,content-type");
    res.header("Content-Type", "application/json;charset=utf-8");
    next();
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

//路由
app.get('/', (req, res) => {
    res.json({
        errcode: 200,
        message: "欢迎使用walatao接口"
    })
})

app.post('/binance/voption/strikePrice', async (req, res) => {
    await binanceRest.optionInfo().then(d => {
        res.json({
            code: 200,
            message: optionTools.getAllStrikePrice(+req.body.expiryDate, d.data)
        })
    }).catch(e => {
        res.json({
            code: 0,
            message: 'error'
        })
        console.error(e)
    })
})

app.get('/binance/voption/expiryDate', async (_req, res) => {

    await binanceRest.optionInfo().then(d => {
        res.json({
            code: 200,
            message: optionTools.getAllExpiryDate(d.data)
        })
    }).catch(e => console.error(e))
})

app.get('/binance/voption/info', async (_req, res) => {

    await binanceRest.optionInfo().then(d => {
        res.json({
            code: 200,
            message: d.data
        })
    }).catch(e => console.error(e))
})

app.post('/binance/voption/newOrder', (req, res) => {
    const params = req.body
    binanceRest.optionNewOrder(params).then(d => {
        if (d.code == 0) {
            res.json({
                code: 200,
                message: d.data
            })
        } else {
            res.json({
                code: 0,
                message: d.code == -1022 ? '签名失效,请重新点击下单' : d.msg
            })
        }
    })
})

app.get('/binance/voption/currentPosition', (_req, res) => {
    binanceRest.optionPosition().then(d => {
        if (d.code == 0) {
            res.json({
                code: 200,
                message: d.data
            })
        } else {
            res.json({
                code: 0,
                message: d.code == -1022 ? '签名失效,请刷新' : d.msg
            })
        }
    }).catch(err => console.error(err))
})


httpServer.listen(80);