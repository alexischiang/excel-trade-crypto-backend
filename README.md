# excel-trade-crypto-backend

Excel-Trade-Crypto 本地后端服务

已封装币安交易所现货、期货、期权REST API&websocket

## 前端仓库
[excel-trade-crypto](https://github.com/alexischiang/excel-trade-crypto)


## 使用方法
- 根目录下新建token.js 格式如下
```javascript
module.export = {
    secret: '', // your secret key
    key: '', // your api key
}
```

- macOS
```bash
npm i 
nodemon ./index.js
```

- windows
```bash
npm i 
node ./index.js
```
