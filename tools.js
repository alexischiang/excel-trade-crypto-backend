/**
 * 期权RESTapi 数据处理
 */


// 数组去重
const unique = (arr) => {
    let res = arr.filter((item, index, arr) => {
        return arr.indexOf(item) == index;
    });
    return res;
}


const optionTools = {
    /**
     * 获取所有行权日
     * @param 接口返回的data数组
     * @returns 行权日数组 由小到大
     */
    getAllExpiryDate (dataArr) {
        let arr = []
        dataArr.forEach(i => arr.push(+i.symbol.split('-')[1]))
        return unique(arr).sort((a, b) => a - b)
    },

    /**
     * 获取某一行权日的所有行权价
     * @param {number} expiryDate 行权日
     * @param {array} dataArr 
     * @returns 当日所有行权价
     */
    getAllStrikePrice (expiryDate, dataArr) {
        const res = dataArr.filter(i => +i.symbol.split('-')[1] == expiryDate).map(j => j.strikePrice)
        return unique(res).sort((a, b) => a - b)
    },

    /**
     * 获取某一行权日所有交易对symbol
     * @param {number} expiryDate 6位数行权日 
     * @param {array} 接口返回的data数组
     * @returns {Object}
     */
    getAllTradePairs (expiryDate, dataArr) {
        const tradePairs = dataArr.filter(i => +i.symbol.split('-')[1] == expiryDate).map(j => j.symbol)
        return {
            expiryDate,
            tradePairs
        }
    }
}







// 根据行权价过滤数据


module.exports = optionTools