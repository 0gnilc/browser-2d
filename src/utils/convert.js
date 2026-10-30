const REGEX = /----|----|--|\|\||\||\/|-/g;

// 卡号|月/年|cvv|姓名|地址|城市|州|邮编|国家
const convert = (text) => {
    if (!text || typeof text !== 'string') {
        return [];
    }
    const lines = text.split("\n").filter(Boolean);
    return lines.map(line => {
        const parts = line.split(REGEX).filter(Boolean);
        if (parts.length < 4) {
            return null;
        }
        const card = parts[0].trim();
        const month = parts[1].trim();
        const year = parts[2].trim();
        const cvv = parts[3].trim();
        const name = parts[4].trim();
        const address = parts[5].trim();
        const city = parts[6].trim();
        const state = parts[7].trim();
        const zip = parts[8].trim();
        const country = parts[9].trim();
        const extra = parts.length > 10 ? parts.slice(10).join("|") : "";
        
        // card: 纯数字，不能小于10位
        if (card && (!/^\d+$/.test(card) || card.length < 10)) {
            return null;
        }
        // month: 纯数字，大于1小于12
        if (month && (!/^\d+$/.test(month) || parseInt(month, 10) < 1 || parseInt(month, 10) > 12)) {
            return null;
        }
        // year: 纯数字
        if (year && !/^\d+$/.test(year)) {
            return null;
        }
        // cvv: 纯数字，不能小于3位
        if (cvv && (!/^\d+$/.test(cvv) || cvv.length < 3)) {
            return null;
        }
        
        return {
            card,
            month,
            year,
            cvv,
            extra,
            name,
            address,
            city,
            state,
            zip,
            country,
        }
    }).filter(item => item !== null);
}

export { convert };