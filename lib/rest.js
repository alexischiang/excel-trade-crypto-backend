const request = require('request');
const qs = require('querystring');
const _ = require('underscore');
const crypto = require('crypto');
const assert = require('assert');

const Beautifier = require('./beautifier.js');

class BinanceRest {
    constructor({
        key,
        secret,
        recvWindow = false,
        timeout = 5000,
        disableBeautification = false,
        handleDrift = false,
        baseUrl = 'https://api.binance.com/',
        requestOptions = {
            proxy: {
                host: "127.0.0.1",
                port: 7890
            }
        }
    }) {
        this.key = key;
        this.secret = secret;
        this.recvWindow = recvWindow;
        this.timeout = timeout;
        this.disableBeautification = disableBeautification;
        this.handleDrift = handleDrift;
        this.requestOptions = requestOptions;

        this._beautifier = new Beautifier();
        this._baseUrl = baseUrl;
        // had trailing slash if necessary
        if ('/' != this._baseUrl.substr(-1)) {
            this._baseUrl += '/';
        }

        this._drift = 0;
        this._syncInterval = 0;
    }

    getBaseUrl () {
        return this._baseUrl;
    }

    _makeRequest (query, callback, route, security, method, attempt = 0) {
        assert(
            _.isUndefined(callback) || _.isFunction(callback),
            'callback must be a function or undefined'
        );
        assert(_.isObject(query), 'query must be an object');

        let queryString;
        const type = _.last(route.split('/')),
            options = Object.assign(
                {
                    url: `${this._baseUrl}${route}`,
                    timeout: this.timeout
                },
                this.requestOptions
            );

        if (security === 'SIGNED') {
            if (this.recvWindow) {
                query.recvWindow = this.recvWindow;
            }
            queryString = qs.stringify(query);
            options.url += '?' + queryString;
            if (options.url.substr(options.url.length - 1) !== '?') {
                options.url += '&';
            }
            options.url += `signature=${this._sign(queryString)}`;
        } else {
            queryString = qs.stringify(query);
            if (queryString) {
                options.url += '?' + queryString;
            }
        }
        if (security === 'API-KEY' || security === 'SIGNED') {
            options.headers = { 'X-MBX-APIKEY': this.key };
        }
        if (method) {
            options.method = method;
        }

        const action = cb => {
            request(options, (err, response, body) => {
                console.log(response.statusCode)
                let payload;
                try {
                    payload = JSON.parse(body);
                } catch (e) {
                    payload = body;
                }
                if (err) {
                    cb(err, payload);
                } else if (
                    response.statusCode < 200 ||
                    response.statusCode > 299
                ) {
                    /*
                     * If we get a response that the timestamp is ahead of the server,
                     * calculate the drift and then attempt the request again
                     */
                    if (
                        response.statusCode === 400 &&
                        payload.code === -1021 &&
                        this.handleDrift &&
                        attempt === 0
                    ) {
                        this.calculateDrift().then(() => {
                            query.timestamp = this._getTime() + this._drift;
                            return this._makeRequest(
                                query,
                                cb,
                                route,
                                security,
                                method,
                                ++attempt
                            );
                        });
                    } else {
                        cb(
                            new Error(`Response code ${response.statusCode}`),
                            payload
                        );
                    }
                } else {
                    if (_.isArray(payload)) {
                        payload = _.map(payload, item => {
                            return this._doBeautifications(item, type);
                        });
                    } else {
                        payload = this._doBeautifications(payload);
                    }
                    cb(err, payload);
                }
            });
        };
        if (callback) {
            action(callback);
        } else {
            return new Promise((resolve, reject) =>
                action((err, payload) => {
                    if (err) {
                        if (payload === undefined) {
                            reject(err);
                        } else {
                            reject(payload);
                        }
                    } else {
                        resolve(payload);
                    }
                })
            );
        }
    }

    _doBeautifications (response, route) {
        if (this.disableBeautification) {
            return response;
        }
        return this._beautifier.beautify(response, route);
    }

    _sign (queryString) {
        return crypto
            .createHmac('sha256', this.secret)
            .update(queryString)
            .digest('hex');
    }

    _setTimestamp (query) {
        if (!query.timestamp) {
            query.timestamp = this._getTime() + this._drift;
        }
    }

    _getTime () {
        return new Date().getTime();
    }

    calculateDrift () {
        const systemTime = this._getTime();
        return this.time().then(response => {
            // Calculate the approximate trip time from here to binance
            const transitTime = parseInt((this._getTime() - systemTime) / 2);
            this._drift = response.serverTime - (systemTime + transitTime);
        });
    }

    startTimeSync (interval = 300000, onRecalculateDriftCb) {
        return new Promise((resolve, reject) => {
            // If there's already an interval running, clear it and reset values
            if (this._syncInterval !== 0) {
                this.endTimeSync();
                return resolve();
            }

            // Calculate initial drift value and setup interval to periodically update it
            this.calculateDrift()
                .then(resolve)
                .catch(reject);

            this._syncInterval = setInterval(() => {
                const promise = this.calculateDrift();

                if (_.isFunction(onRecalculateDriftCb)) {
                    onRecalculateDriftCb(promise);
                }
            }, interval);
        });
    }

    endTimeSync () {
        clearInterval(this._syncInterval);
        this._drift = 0;
        this._syncInterval = 0;
    }

    // Public APIs
    ping (callback) {
        if (this._baseUrl == 'https://vapi.binance.com') {
            return this._makeRequest({}, callback, 'vapi/v1/ping');
        } else {
            return this._makeRequest({}, callback, 'api/v1/ping');
        }

    }

    time (callback) {
        if (this._baseUrl == 'https://vapi.binance.com') {
            return this._makeRequest({}, callback, 'vapi/v1/time');
        } else {
            return this._makeRequest({}, callback, 'api/v3/time');
        }
    }

    depth (query = {}, callback) {
        if (_.isString(query)) {
            query = { symbol: query };
        }

        return this._makeRequest(query, callback, 'api/v1/depth');
    }

    trades (query = {}, callback) {
        if (_.isString(query)) {
            query = { symbol: query };
        }

        return this._makeRequest(query, callback, 'api/v1/trades');
    }

    historicalTrades (query = {}, callback) {
        if (_.isString(query)) {
            query = { symbol: query };
        }

        return this._makeRequest(
            query,
            callback,
            'api/v1/historicalTrades',
            'API-KEY'
        );
    }

    aggTrades (query = {}, callback) {
        if (_.isString(query)) {
            query = { symbol: query };
        }

        return this._makeRequest(query, callback, 'api/v1/aggTrades');
    }

    exchangeInfo (callback) {
        return this._makeRequest({}, callback, 'api/v1/exchangeInfo');
    }

    klines (query = {}, callback) {
        return this._makeRequest(query, callback, 'api/v1/klines');
    }

    ticker24hr (query = {}, callback) {
        if (_.isString(query)) {
            query = { symbol: query };
        }

        return this._makeRequest(query, callback, 'api/v1/ticker/24hr');
    }

    tickerPrice (query = {}, callback) {
        if (_.isString(query)) {
            query = { symbol: query };
        }

        return this._makeRequest(query, callback, 'api/v3/ticker/price');
    }

    bookTicker (query = {}, callback) {
        if (_.isString(query)) {
            query = { symbol: query };
        }

        return this._makeRequest(query, callback, 'api/v3/ticker/bookTicker');
    }

    allBookTickers (callback) {
        return this._makeRequest({}, callback, 'api/v1/ticker/allBookTickers');
    }

    allPrices (callback) {
        return this._makeRequest({}, callback, 'api/v1/ticker/allPrices');
    }

    // Private APIs
    newOrder (query = {}, callback) {
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            'api/v3/order',
            'SIGNED',
            'POST'
        );
    }

    testOrder (query = {}, callback) {
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            'api/v3/order/test',
            'SIGNED',
            'POST'
        );
    }

    queryOrder (query = {}, callback) {
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'api/v3/order', 'SIGNED');
    }

    cancelOrder (query = {}, callback) {
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            'api/v3/order',
            'SIGNED',
            'DELETE'
        );
    }

    // 现货 当前挂单
    openOrders (query = {}, callback) {
        if (_.isString(query)) {
            query = { symbol: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            'api/v3/openOrders',
            'SIGNED'
        );
    }

    allOrders (query = {}, callback) {
        if (_.isString(query)) {
            query = { symbol: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'api/v3/allOrders', 'SIGNED');
    }

    account (query = {}, callback) {
        if (_.isFunction(query)) {
            callback = query;
            query = {};
        }
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'api/v3/account', 'SIGNED');
    }

    myTrades (query = {}, callback) {
        if (_.isString(query)) {
            query = { symbol: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'api/v3/myTrades', 'SIGNED');
    }

    withdraw (query = {}, callback) {
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            'wapi/v3/withdraw.html',
            'SIGNED',
            'POST'
        );
    }

    depositHistory (query = {}, callback) {
        if (_.isString(query)) {
            query = { asset: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            'wapi/v3/depositHistory.html',
            'SIGNED'
        );
    }

    withdrawHistory (query = {}, callback) {
        if (_.isString(query)) {
            query = { asset: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            'wapi/v3/withdrawHistory.html',
            'SIGNED'
        );
    }

    depositAddress (query = {}, callback) {
        if (_.isString(query)) {
            query = { asset: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            'wapi/v3/depositAddress.html',
            'SIGNED'
        );
    }

    depositAddressWithNetwork (query = {}, callback) {
        if (_.isString(query)) {
            query = { asset: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            'sapi/v1/capital/deposit/hisrec',
            'SIGNED'
        );
    }

    allCoinsInformation (query = {}, callback) {
        if (_.isString(query)) {
            query = { asset: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            'sapi/v1/capital/config/getall',
            'SIGNED'
        );
    }

    accountStatus (callback) {
        const query = {};
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            'wapi/v3/accountStatus.html',
            'SIGNED'
        );
    }

    startUserDataStream (callback) {
        console.log(this._baseUrl)
        if (this._baseUrl == 'https://vapi.binance.com/') {
            const query = {};
            this._setTimestamp(query);
            return this._makeRequest(
                query,
                callback,
                'vapi/v1/userDataStream',
                'API-KEY',
                'POST'
            );
        } else {
            return this._makeRequest(
                {},
                callback,
                'api/v3/userDataStream',
                'API-KEY',
                'POST'
            );
        }
    }

    keepAliveUserDataStream (query = {}, callback) {
        if (this._baseUrl == 'https://vapi.binance.com/') {
            return this._makeRequest(
                query,
                callback,
                'vapi/v1/userDataStream',
                'API-KEY',
                'PUT'
            );
        } else {
            return this._makeRequest(
                query,
                callback,
                'api/v1/userDataStream',
                'API-KEY',
                'PUT'
            );
        }
    }

    closeUserDataStream (query = {}, callback) {
        if (this._baseUrl == 'https://vapi.binance.com/') {
            return this._makeRequest(
                query,
                callback,
                'vapi/v1/userDataStream',
                'API-KEY',
                'DELETE'
            );
        } else {
            return this._makeRequest(
                query,
                callback,
                'api/v1/userDataStream',
                'API-KEY',
                'DELETE'
            );
        }
    }

    // !! Option 期权

    // Public APIs

    // 获取此时的交易对信息
    optionInfo (callback) {
        return this._makeRequest({}, callback, 'vapi/v1/optionInfo');
    }

    // 现货指数价格获取
    optionIndex (query = {}, callback) {
        if (_.isString(query)) {
            query = { underlying: query };
        }
        return this._makeRequest(query, callback, 'vapi/v1/index');
    }

    // 获取最新标记价格
    optionMark (query = {}, callback) {
        if (_.isString(query)) {
            query = { symbol: query };
        }
        return this._makeRequest(query, callback, 'vapi/v1/mark');
    }


    // Private APIs

    // 账户资产信息(USER_DATA)
    optionAccount (query = {}, callback) {
        if (_.isFunction(query)) {
            callback = query;
            query = {};
        }
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'vapi/v1/account', 'SIGNED');
    }

    // 期权持仓信息(USER_DATA)
    optionPosition (query = {}, callback) {
        if (_.isString(query)) {
            query = { symbol: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(query, callback, 'vapi/v1/position', 'SIGNED');
    }

    // 期权查询当前挂单 (TRADE)
    optionCurrentOrders (query = {}, callback) {
        if (_.isString(query)) {
            query = { symbol: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            'vapi/v1/openOrders',
            'SIGNED'
        );
    }

    // 下单
    // 期权下单 (TRADE)
    optionNewOrder (query = {}, callback) {
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            '/vapi/v1/order',
            'SIGNED',
            'POST'
        );
    }

    // 撤单

    // 期权下单 (TRADE)
    optionDeleteOrder (query = {}, callback) {
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            '/vapi/v1/order',
            'SIGNED',
            'DELETE'
        );
    }


    // 期权查询成交历史 (USER_DATA)
    optionHistoryTrades (query = {}, callback) {
        if (_.isString(query)) {
            query = { symbol: query };
        }
        this._setTimestamp(query);
        return this._makeRequest(
            query,
            callback,
            'vapi/v1/userTrades',
            'SIGNED'
        );
    }


}

module.exports = BinanceRest;
