const WebSocket = require('ws');
const _ = require('underscore');

const Beautifier = require('./beautifier.js');

const BinanceErrors = Object.freeze({
    INVALID_LISTEN_KEY: -1125
});

class BinanceWS {
    constructor(beautify = true) {
        this._baseUrl = 'wss://vstream.binance.com/ws/';
        this._combinedBaseUrl = 'wss://vstream.binance.com/stream?streams=';
        this._sockets = {};
        this._beautifier = new Beautifier();
        this._beautify = beautify;

        this.streams = {
            depth: symbol => `${symbol.toLowerCase()}@depth`,
            depthLevel: (symbol, level) =>
                `${symbol.toLowerCase()}@depth${level}`,
            kline: (symbol, interval) =>
                `${symbol.toLowerCase()}@kline_${interval}`,
            aggTrade: symbol => `${symbol.toLowerCase()}@aggTrade`,
            trade: symbol => `${symbol.toLowerCase()}@trade`,
            ticker: symbol => `${symbol}@ticker`,
            allTickers: () => '!ticker@arr'
        };

        // Reference to the setInterval timer for sending keep alive requests in onUserData
        this._userDataRefresh = {
            intervaId: false,
            failCount: 0
        };
    }

    _setupWebSocket (eventHandler, path, isCombined) {
        if (this._sockets[path]) {
            return this._sockets[path];
        }
        path = (isCombined ? this._combinedBaseUrl : this._baseUrl) + path;
        const ws = new WebSocket(path);
        console.log(path)
        ws.onopen = () => {
            console.log('Binance Option Websocket connected!')

            // 期权ws数据默认是GZIP压缩数据 连接成功后发送 {"method":"BINARY", "params":["false"], "id":1} 转换为文本数据
            ws.send(JSON.stringify({ "method": "BINARY", "params": ["false"], "id": 1 }))
        }

        ws.on('message', message => {
            let event;
            try {
                event = JSON.parse(message);
            } catch (e) {
                event = message;
            }
            if (this._beautify) {
                if (event.stream) {
                    event.data = this._beautifyResponse(event.data);
                } else {
                    event = this._beautifyResponse(event);
                }
            }
            // 跳过第一条响应 {id:1}
            if (Object.keys(event).includes('data')) {
                eventHandler(event);
            }
        });

        ws.on('error', () => {
            // node.js EventEmitters will throw and then exit if no error listener is registered
        });

        return ws;
    }

    _beautifyResponse (data) {
        if (_.isArray(data)) {
            return _.map(data, event => {
                if (event.e) {
                    return this._beautifier.beautify(event, event.e + 'Event');
                }
                return event;
            });
        } else if (data.e) {
            return this._beautifier.beautify(data, data.e + 'Event');
        }
        return data;
    }

    _clearUserDataInterval () {
        if (this._userDataRefresh.intervaId) {
            clearInterval(this._userDataRefresh.intervaId);
        }

        this._userDataRefresh.intervaId = false;
        this._userDataRefresh.failCount = 0;
    }

    _sendUserDataKeepAlive (binanceRest, response) {
        return binanceRest.keepAliveUserDataStream(response).catch(e => {
            this._userDataRefresh.failCount++;
            const msg =
                'Failed requesting keepAliveUserDataStream for onUserData listener';
            if (e && e.code === BinanceErrors.INVALID_LISTEN_KEY) {
                console.error(
                    new Date(),
                    msg,
                    'listen key expired - clearing keepAlive interval',
                    e
                );
                this._clearUserDataInterval();
                return;
            }
            console.error(
                new Date(),
                msg,
                'failCount: ',
                this._userDataRefresh.failCount,
                e
            );
        });
    }


    onTrade (symbol, eventHandler) {
        return this._setupWebSocket(eventHandler, this.streams.trade(symbol));
    }

    onTicker (symbol, eventHandler) {
        return this._setupWebSocket(eventHandler, this.streams.ticker(symbol));
    }

    async onAllTickers (binanceRest, eventHandler) {
        let streamsArr = []
        await binanceRest.optionInfo().then(d => {
            d.data.forEach(item => {
                console.log(item.symbol)
                streamsArr.push(this.streams.ticker(item.symbol))
            })
        })

        this.onCombinedStream(streamsArr, eventHandler);
    }

    onUserData (binanceRest, eventHandler, interval = 60000) {
        this._clearUserDataInterval();
        return binanceRest.startUserDataStream().then(response => {
            this._userDataRefresh.intervaId = setInterval(
                () => this._sendUserDataKeepAlive(binanceRest, response),
                interval
            );
            this._userDataRefresh.failCount = 0;

            return this._setupWebSocket(eventHandler, response.listenKey);
        });
    }

    onCombinedStream (streams, eventHandler) {
        return this._setupWebSocket(eventHandler, streams.join('/'), true);
    }
}

module.exports = BinanceWS;
